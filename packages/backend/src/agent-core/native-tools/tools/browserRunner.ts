import type { AgentToolResult, BrowserAuthStateProvider, BrowserToolInput } from '@ant-chat/shared'
import type { BrowserSessionState } from './browserSessionManager'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000
const MAX_OUTPUT_CHARS = 20_000
const DAEMON_IDLE_TIMEOUT_MS = '300000'

const ALLOWED_COMMANDS = new Set([
  'open',
  'close',
  'snapshot',
  'eval',
  'click',
  'dblclick',
  'focus',
  'type',
  'fill',
  'press',
  'keydown',
  'keyup',
  'hover',
  'select',
  'check',
  'uncheck',
  'scroll',
  'wait',
  'screenshot',
  'pdf',
  'download',
  'back',
  'forward',
  'reload',
  'get text',
  'get html',
  'get value',
  'get attr',
  'get count',
  'get box',
  'get styles',
  'get url',
  'get title',
  'find role',
  'find text',
  'find label',
  'find placeholder',
  'find alt',
  'find testid',
  'tab new',
  'tab list',
  'tab switch',
  'tab close',
  'dialog accept',
  'dialog dismiss',
])

const BLOCKED_FLAGS = new Set([
  '--config',
  '--extension',
  '--cdp',
  '--auto-connect',
  '--provider',
  '--state',
  '--init-script',
  '--executable-path',
  '--allow-file-access',
  '--remote-debugging-port',
  '--proxy-server',
  '--disable-web-security',
  '--user-data-dir',
])

const COMMON_FLAGS = new Set(['--json'])
const COMMAND_FLAGS: Record<string, Set<string>> = {
  'snapshot': new Set(['-i', '-C', '-s', '-u', '-c', '-d', '--json']),
  'eval': new Set(['-b']),
  'click': new Set(['--new-tab']),
  'scroll': new Set(['--selector']),
  'wait': new Set(['--load', '--url', '--download']),
  'screenshot': new Set(['--full', '--annotate']),
  'find role': new Set(['--name', '--exact']),
  'find text': new Set(['--exact']),
}

const PATH_OUTPUT_COMMANDS = new Set(['screenshot', 'pdf'])
const directSessions = new Map<string, BrowserSessionState>()
const browserCommandCache = new Map<string, BrowserCommand | null>()

export interface BrowserRunnerOptions {
  workspacePath?: string
  profilePath: string
  artifactsPath: string
  env?: NodeJS.ProcessEnv
  proxyUrl?: string
  state?: BrowserSessionState
  authStateProvider?: BrowserAuthStateProvider
}

interface BrowserCommand {
  executablePath: string
  executableArgs: string[]
}

export function validateBrowserInput(
  input: BrowserToolInput,
  options: Pick<BrowserRunnerOptions, 'workspacePath' | 'artifactsPath'>,
): string | null {
  const command = normalizeCommand(input.command)
  if (!ALLOWED_COMMANDS.has(command)) {
    return `browser command is not allowed: ${command || '(empty)'}`
  }
  if (input.args !== undefined && (!Array.isArray(input.args) || input.args.some(arg => typeof arg !== 'string'))) {
    return 'browser args must be an array of strings'
  }
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
    return 'browser timeoutMs must be a positive number'
  }

  const args = input.args ?? []
  for (const flag of BLOCKED_FLAGS) {
    if (args.some(arg => arg === flag || arg.startsWith(`${flag}=`))) {
      return `browser flag is not allowed: ${flag}`
    }
  }
  if (args.some(arg => arg.startsWith('--profile='))) {
    return 'browser --profile must use a separate Chrome profile name argument'
  }

  const profileIndex = args.indexOf('--profile')
  if (profileIndex >= 0) {
    const profile = args[profileIndex + 1]
    if (!profile || profile.startsWith('-') || profile.includes('/') || profile.includes('\\')) {
      return 'browser --profile only accepts a Chrome profile name'
    }
  }

  const { commandArgs } = extractGlobalArgs(args)
  const invalidFlag = commandArgs.find(arg =>
    arg.startsWith('-')
    && !COMMON_FLAGS.has(arg)
    && !(COMMAND_FLAGS[command]?.has(arg) ?? false),
  )
  if (invalidFlag) {
    return `browser flag is not allowed for ${command}: ${invalidFlag}`
  }

  if (command === 'open') {
    const url = commandArgs.find(arg => !arg.startsWith('-'))
    if (!url || !isHttpUrl(url)) {
      return 'browser open requires an http or https URL'
    }
  }

  const outputPaths = getOutputPaths(command, commandArgs)
  for (const outputPath of outputPaths) {
    if (!isAllowedOutputPath(outputPath, options.workspacePath, options.artifactsPath)) {
      return `browser output path is outside allowed roots: ${outputPath}`
    }
  }

  return null
}

export async function runBrowserTool(
  input: BrowserToolInput,
  options: BrowserRunnerOptions,
): Promise<AgentToolResult> {
  const validationError = validateBrowserInput(input, options)
  if (validationError) {
    return { ok: false, result: validationError }
  }

  const state = options.state ?? createDirectSessionState(options.profilePath)
  const previous = state.queue
  let release: () => void = () => {}
  state.queue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous

  try {
    return await executeBrowserTool(input, { ...options, state })
  }
  finally {
    release()
  }
}

async function executeBrowserTool(
  input: BrowserToolInput,
  options: BrowserRunnerOptions,
): Promise<AgentToolResult> {
  const startedAt = Date.now()
  const browserCommand = resolveBrowserCommand(options.env)
  if (!browserCommand) {
    return {
      ok: false,
      result: [
        'Browser tool failed: 未找到 agent-browser CLI。',
        '已检查系统 PATH 和 npx。请安装 agent-browser，并确保命令位于 PATH 中。',
      ].join('\n'),
      diagnostics: { durationMs: Date.now() - startedAt },
    }
  }

  const state = options.state!
  await fs.promises.mkdir(state.profilePath, { recursive: true, mode: 0o700 })
  await fs.promises.chmod(state.profilePath, 0o700)
  await fs.promises.mkdir(state.socketPath, { recursive: true, mode: 0o700 })
  await fs.promises.mkdir(options.artifactsPath, { recursive: true, mode: 0o700 })

  const command = normalizeCommand(input.command)
  const { globalArgs, commandArgs } = extractGlobalArgs(input.args ?? [])
  const explicitHeaded = globalArgs.includes('--headed')
  const explicitProfileIndex = globalArgs.indexOf('--profile')
  if (explicitHeaded) {
    state.headed = true
  }
  if (explicitProfileIndex >= 0) {
    state.profile = globalArgs[explicitProfileIndex + 1]
  }
  const profileArgs = explicitProfileIndex < 0
    ? ['--profile', state.profile ?? state.profilePath]
    : []
  const sessionArgs = ['--session', state.sessionName]
  const headedArgs = state.headed && !explicitHeaded ? ['--headed'] : []
  const args = [
    ...browserCommand.executableArgs,
    ...profileArgs,
    ...sessionArgs,
    ...(command === 'open' ? ['--content-boundaries'] : []),
    ...globalArgs,
    ...headedArgs,
    ...command.split(' '),
    ...normalizeOutputPaths(command, commandArgs, options.workspacePath),
  ]
  // 显式系统 Profile 是 outside 能力，不得把应用托管状态混入用户原始 Profile。
  const env = createBrowserEnv(options, state.socketPath, explicitProfileIndex < 0)
  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

  return await new Promise((resolve) => {
    const outputId = randomUUID()
    const stdoutPath = path.join(state.socketPath, `.stdout-${outputId}`)
    const stderrPath = path.join(state.socketPath, `.stderr-${outputId}`)
    const stdoutFd = fs.openSync(stdoutPath, 'w', 0o600)
    const stderrFd = fs.openSync(stderrPath, 'w', 0o600)
    const child = spawn(browserCommand.executablePath, args, {
      cwd: options.workspacePath,
      shell: false,
      env,
      stdio: ['ignore', stdoutFd, stderrFd],
    })
    fs.closeSync(stdoutFd)
    fs.closeSync(stderrFd)
    let timedOut = false
    let settled = false

    const finish = (result: AgentToolResult) => {
      if (settled)
        return
      settled = true
      fs.rmSync(stdoutPath, { force: true })
      fs.rmSync(stderrPath, { force: true })
      resolve(result)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      if (command === 'close') {
        resetSessionState(state)
        terminateDaemon(state)
      }
      finish({
        ok: false,
        result: error.message.includes('ENOENT')
          ? [
              'Browser tool failed: 未找到 agent-browser CLI。',
              '已检查系统 PATH 和 npx。请安装 agent-browser，并确保命令位于 PATH 中。',
            ].join('\n')
          : error.message,
        diagnostics: { durationMs: Date.now() - startedAt },
      })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      const stdout = readOutputFile(stdoutPath)
      const stderr = readOutputFile(stderrPath)
      if (command === 'close') {
        resetSessionState(state)
        terminateDaemon(state)
      }
      if (timedOut) {
        finish({
          ok: false,
          result: formatProcessResult(stdout, stderr, exitCode ?? undefined) || 'AGENT_BROWSER_TIMEOUT',
          diagnostics: {
            stdout,
            stderr,
            exitCode: exitCode ?? undefined,
            durationMs: Date.now() - startedAt,
          },
        })
        return
      }

      const ok = exitCode === 0
      if (ok && command !== 'close') {
        state.started = true
      }
      const cleanStdout = removeDaemonOptionWarnings(stdout)
      const cleanStderr = removeDaemonOptionWarnings(stderr)
      finish({
        ok,
        result: ok
          ? cleanStdout
          : (formatProcessResult(cleanStdout, cleanStderr, exitCode ?? undefined) || `agent-browser exited with code ${exitCode}`),
        diagnostics: {
          stdout: cleanStdout,
          stderr: cleanStderr,
          exitCode: exitCode ?? undefined,
          durationMs: Date.now() - startedAt,
        },
      })
    })
  })
}

function formatProcessResult(stdout: string, stderr: string, exitCode?: number): string {
  const parts: string[] = []
  if (stdout) {
    parts.push(`stdout:\n${stdout}`)
  }
  if (stderr) {
    parts.push(`stderr:\n${stderr}`)
  }
  if (exitCode !== undefined) {
    parts.push(`exitCode=${exitCode}`)
  }
  return parts.join('\n')
}

function resolveBrowserCommand(envOverrides?: NodeJS.ProcessEnv): BrowserCommand | null {
  const env = {
    ...process.env,
    ...envOverrides,
  }
  const pathValue = env.PATH ?? ''
  const cacheKey = `${process.platform}\0${pathValue}`
  const cached = browserCommandCache.get(cacheKey)
  if (cached !== undefined)
    return cached

  const agentBrowserPath = findExecutableOnPath('agent-browser', pathValue)
  const command = agentBrowserPath
    ? { executablePath: agentBrowserPath, executableArgs: [] }
    : resolveNpxCommand(pathValue)
  browserCommandCache.set(cacheKey, command)
  return command
}

function resolveNpxCommand(pathValue: string): BrowserCommand | null {
  const npxPath = findExecutableOnPath('npx', pathValue)
  return npxPath
    ? { executablePath: npxPath, executableArgs: ['agent-browser'] }
    : null
}

function findExecutableOnPath(name: string, pathValue: string): string | undefined {
  const pathApi = process.platform === 'win32' ? path.win32 : path
  const names = process.platform === 'win32'
    ? [`${name}.cmd`, `${name}.exe`, name]
    : [name]

  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const executableName of names) {
      const candidate = pathApi.join(directory, executableName)
      if (isExecutableFile(candidate))
        return candidate
    }
  }

  return undefined
}

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
    return fs.statSync(candidate).isFile()
  }
  catch {
    return false
  }
}

function normalizeCommand(command: string): string {
  return String(command || '').trim().replace(/\s+/g, ' ')
}

function extractGlobalArgs(args: string[]): { globalArgs: string[], commandArgs: string[] } {
  const globalArgs: string[] = []
  const commandArgs: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--headed') {
      globalArgs.push(arg)
      continue
    }
    if (arg === '--profile') {
      globalArgs.push(arg, args[index + 1]!)
      index++
      continue
    }
    commandArgs.push(arg)
  }
  return { globalArgs, commandArgs }
}

function createBrowserEnv(options: BrowserRunnerOptions, socketPath?: string, includeAuthState = true): NodeJS.ProcessEnv {
  const source = {
    ...process.env,
    ...options.env,
  }
  const proxy = options.proxyUrl
    ?? (source.HTTPS_PROXY || source.HTTP_PROXY || source.https_proxy || source.http_proxy)
  const authState = includeAuthState ? options.state?.authState ?? options.authStateProvider?.getState() : undefined
  return {
    ...source,
    AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
    AGENT_BROWSER_DOWNLOAD_PATH: options.artifactsPath,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: DAEMON_IDLE_TIMEOUT_MS,
    AGENT_BROWSER_SCREENSHOT_DIR: options.artifactsPath,
    ...(socketPath ? { AGENT_BROWSER_SOCKET_DIR: socketPath } : {}),
    ...(proxy ? { AGENT_BROWSER_PROXY: proxy } : {}),
    ...(authState
      ? {
          AGENT_BROWSER_STATE: authState.statePath,
          AGENT_BROWSER_ENCRYPTION_KEY: authState.encryptionKey,
        }
      : {}),
  }
}

function getOutputPaths(command: string, args: string[]): string[] {
  if (PATH_OUTPUT_COMMANDS.has(command)) {
    const pathArg = args.find(arg => !arg.startsWith('-'))
    return pathArg ? [pathArg] : []
  }
  if (command === 'download') {
    const pathArg = args[args.length - 1]
    return pathArg && !pathArg.startsWith('-') ? [pathArg] : []
  }
  if (command === 'wait') {
    const downloadIndex = args.indexOf('--download')
    return downloadIndex >= 0 && args[downloadIndex + 1] ? [args[downloadIndex + 1]!] : []
  }
  return []
}

function normalizeOutputPaths(command: string, args: string[], workspacePath?: string): string[] {
  const outputPaths = new Set(getOutputPaths(command, args))
  if (!workspacePath || outputPaths.size === 0) {
    return args
  }
  return args.map(arg => outputPaths.has(arg) && !path.isAbsolute(arg) ? path.resolve(workspacePath, arg) : arg)
}

function isAllowedOutputPath(outputPath: string, workspacePath: string | undefined, artifactsPath: string): boolean {
  const roots = [workspacePath, artifactsPath].filter((value): value is string => Boolean(value))
  const absolutePath = path.resolve(workspacePath ?? artifactsPath, outputPath)
  return roots.some(root => isPathInsideAllowedRoot(absolutePath, root))
}

function isPathInsideAllowedRoot(targetPath: string, rootPath: string): boolean {
  const absoluteRoot = path.resolve(rootPath)
  if (!isPathInside(targetPath, absoluteRoot)) {
    return false
  }
  if (!fs.existsSync(absoluteRoot)) {
    return true
  }

  const realRoot = fs.realpathSync.native(absoluteRoot)
  let existingAncestor = targetPath
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor)
    if (parent === existingAncestor) {
      return false
    }
    existingAncestor = parent
  }
  const realAncestor = fs.realpathSync.native(existingAncestor)
  const resolvedTarget = path.resolve(realAncestor, path.relative(existingAncestor, targetPath))
  return isPathInside(resolvedTarget, realRoot)
}

function isPathInside(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

function removeDaemonOptionWarnings(output: string): string {
  return output
    .split('\n')
    .filter(line => !line.includes('ignored: daemon already running'))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

function createDirectSessionState(profilePath: string): BrowserSessionState {
  const existing = directSessions.get(profilePath)
  if (existing) {
    return existing
  }
  const id = `ant-chat-direct-${process.pid}`
  const state: BrowserSessionState = {
    sessionName: id,
    socketPath: path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), id),
    profilePath,
    headed: false,
    started: false,
    profile: undefined,
    queue: Promise.resolve(),
  }
  directSessions.set(profilePath, state)
  return state
}

function readOutputFile(filePath: string): string {
  try {
    return appendTruncated('', fs.readFileSync(filePath, 'utf8'))
  }
  catch {
    return ''
  }
}

function terminateDaemon(state: BrowserSessionState): void {
  const pidPath = path.join(state.socketPath, `${state.sessionName}.pid`)
  try {
    const pid = Number(fs.readFileSync(pidPath, 'utf8').trim())
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, 'SIGTERM')
    }
  }
  catch {
    // The close command may have already stopped the daemon.
  }
  fs.rmSync(state.socketPath, { recursive: true, force: true })
}

function resetSessionState(state: BrowserSessionState): void {
  state.started = false
  state.headed = false
  state.profile = undefined
}

function appendTruncated(current: string, next: string): string {
  const value = current + next
  return value.length <= MAX_OUTPUT_CHARS
    ? value
    : `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`
}
