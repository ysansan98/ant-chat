import type { AgentToolResult, BrowserToolInput } from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000
const MAX_OUTPUT_CHARS = 20_000
const DAEMON_IDLE_TIMEOUT_MS = '300000'
const SESSION_NAME = 'ant-chat'

const ALLOWED_COMMANDS = new Set([
  'open',
  'close',
  'snapshot',
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
  'get attribute',
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
  'skills get',
  'skills list',
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
  'snapshot': new Set(['-i', '-C', '-s', '--json']),
  'click': new Set(['--new-tab']),
  'scroll': new Set(['--selector']),
  'wait': new Set(['--load', '--url', '--download']),
  'screenshot': new Set(['--full', '--annotate']),
  'skills get': new Set(['--full']),
  'find role': new Set(['--name', '--exact']),
  'find text': new Set(['--exact']),
}

const PATH_OUTPUT_COMMANDS = new Set(['screenshot', 'pdf'])
let browserQueue: Promise<void> = Promise.resolve()

export interface BrowserRunnerOptions {
  executablePath: string
  workspacePath?: string
  profilePath: string
  artifactsPath: string
  env?: NodeJS.ProcessEnv
  proxyUrl?: string
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
    return { ok: false, error: validationError }
  }

  const previous = browserQueue
  let release: () => void = () => {}
  browserQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous

  try {
    return await executeBrowserTool(input, options)
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
  await fs.promises.mkdir(options.profilePath, { recursive: true })
  await fs.promises.mkdir(options.artifactsPath, { recursive: true })

  const command = normalizeCommand(input.command)
  const { globalArgs, commandArgs } = extractGlobalArgs(input.args ?? [])
  const profileArgs = globalArgs.includes('--profile')
    ? []
    : ['--profile', options.profilePath]
  const args = [
    ...profileArgs,
    '--session',
    SESSION_NAME,
    '--content-boundaries',
    ...globalArgs,
    ...command.split(' '),
    ...normalizeOutputPaths(command, commandArgs, options.workspacePath),
  ]
  const env = createBrowserEnv(options)
  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

  return await new Promise((resolve) => {
    const child = spawn(options.executablePath, args, {
      cwd: options.workspacePath,
      shell: false,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const finish = (result: AgentToolResult) => {
      if (settled)
        return
      settled = true
      resolve(result)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendTruncated(stdout, chunk.toString())
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendTruncated(stderr, chunk.toString())
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, error: error.message, stdout, stderr, durationMs: Date.now() - startedAt })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (timedOut) {
        finish({
          ok: false,
          error: 'AGENT_BROWSER_TIMEOUT',
          stdout,
          stderr,
          exitCode: exitCode ?? undefined,
          durationMs: Date.now() - startedAt,
        })
        return
      }

      const ok = exitCode === 0
      finish({
        ok,
        error: ok ? undefined : (stderr.trim() || `agent-browser exited with code ${exitCode}`),
        stdout,
        stderr,
        exitCode: exitCode ?? undefined,
        durationMs: Date.now() - startedAt,
      })
    })

    child.stdin.end()
  })
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

function createBrowserEnv(options: BrowserRunnerOptions): NodeJS.ProcessEnv {
  const source = {
    ...process.env,
    ...options.env,
  }
  const proxy = options.proxyUrl
    ?? (source.HTTPS_PROXY || source.HTTP_PROXY || source.https_proxy || source.http_proxy)
  return {
    ...source,
    AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
    AGENT_BROWSER_DOWNLOAD_PATH: options.artifactsPath,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: DAEMON_IDLE_TIMEOUT_MS,
    AGENT_BROWSER_SCREENSHOT_DIR: options.artifactsPath,
    ...(proxy ? { AGENT_BROWSER_PROXY: proxy } : {}),
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

function appendTruncated(current: string, next: string): string {
  const value = current + next
  return value.length <= MAX_OUTPUT_CHARS
    ? value
    : `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`
}
