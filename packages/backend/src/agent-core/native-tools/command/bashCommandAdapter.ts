import type { AvailableCommandHost, CommandInput, CommandRisk, PreparedCommandSegment, PreparedCommandState } from './types'
import fs from 'node:fs'
import path from 'node:path'
import { parseBashCommand } from '../tools/bashCommandParser'

const HIGH_RISK_COMMANDS = new Set([
  'rm',
  'sudo',
  'curl',
  'wget',
  'ssh',
  'scp',
  'env',
  'command',
  'export',
  'declare',
  'typeset',
  'set',
  'unset',
  'readonly',
])

const DYNAMIC_COMMANDS = new Set([
  'eval',
  'exec',
  'builtin',
  'sh',
  'bash',
  'zsh',
  'dash',
  'fish',
  'cmd',
  'powershell',
  'pwsh',
])

const PACKAGE_INSTALL_COMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set(['install', 'i', 'ci', 'add']),
  pnpm: new Set(['install', 'i', 'add']),
  yarn: new Set(['install', 'add']),
  pip: new Set(['install']),
  pip3: new Set(['install']),
}

export interface PrepareBashCommandOptions {
  trustedPaths?: string[]
  blockAgentBrowser?: boolean
  isMountPoint?: (targetPath: string) => boolean
}

export function prepareBashCommand(
  input: CommandInput,
  workspacePath: string,
  host: AvailableCommandHost,
  options: PrepareBashCommandOptions = {},
): PreparedCommandState {
  if (host.adapter !== 'bash' || host.interpreter !== 'bash') {
    throw new Error('Bash adapter 只能使用 Bash Command Host')
  }

  const parsed = parseBashCommand(input, workspacePath, {
    executableSearchPath: host.environment.PATH,
    trustedPaths: options.trustedPaths,
    blockAgentBrowser: options.blockAgentBrowser,
  })
  const risk = classifyBashRisk(
    parsed,
    workspacePath,
    host.environment.HOME,
    options.blockAgentBrowser,
    options.isMountPoint ?? isExistingMountPoint,
  )
  const segments: PreparedCommandSegment[] = parsed.segments.map(segment => ({
    executable: segment.command,
    args: [...segment.args],
    cwd: segment.cwd,
    isCd: segment.isCd,
    isReadOnly: segment.isReadOnly,
    resourceScope: segment.resourceScope,
  }))

  return {
    kind: 'command',
    interpreter: 'bash',
    input,
    command: input.command,
    cwd: parsed.cwd,
    segments,
    resourceScope: parsed.resourceScope,
    isReadOnly: parsed.isReadOnly && risk.risk === 'ordinary',
    hasSecretEnv: parsed.hasSecretEnv,
    risk: risk.risk,
    riskReason: risk.reason,
    executionPlan: {
      executablePath: host.executablePath,
      args: ['--noprofile', '--norc', '-c', input.command],
      cwd: parsed.cwd,
      environment: { ...host.environment },
    },
    adapterState: parsed,
  }
}

function classifyBashRisk(
  parsed: ReturnType<typeof parseBashCommand>,
  workspacePath: string,
  homePath: string | undefined,
  blockAgentBrowser = false,
  isMountPoint: (targetPath: string) => boolean,
): { risk: CommandRisk, reason?: string } {
  if (parsed.segments.some(segment => isDynamicCommand(segment.executableBasename))) {
    return { risk: 'bottomline_block', reason: '命令包含无法证明授权对象等于执行对象的动态解释器或脚本结构' }
  }

  for (const segment of parsed.segments) {
    if (blockAgentBrowser && isAgentBrowser(segment.executableBasename, segment.args)) {
      return { risk: 'bottomline_block', reason: '命令不得绕过 Browser 工具直接启动 agent-browser' }
    }
    const unwrapped = unwrapStaticCommand(segment.executableBasename, segment.args)
    if (!unwrapped) {
      return { risk: 'bottomline_block', reason: '包装命令的最终执行对象无法静态确认' }
    }
    if (unwrapped.executable === 'rm') {
      const protectedTarget = findProtectedPosixDeleteTarget(
        unwrapped.args,
        segment.cwd,
        workspacePath,
        homePath,
        isMountPoint,
      )
      if (protectedTarget) {
        return {
          risk: 'bottomline_block',
          reason: `删除目标命中不可覆盖的底线保护：${protectedTarget}`,
        }
      }
    }
  }

  if (parsed.isBlocked && !isLegacyHighRiskBlock(parsed.blockReason)) {
    return {
      risk: 'bottomline_block',
      reason: parsed.blockReason || '命令无法可靠解析或验证',
    }
  }

  if (
    parsed.hasSecretEnv
    || parsed.hasShellSyntax
    || parsed.segments.some(segment => isHighRiskCommand(segment.executableBasename, segment.args))
  ) {
    return { risk: 'requires_approval', reason: '命令包含删除、网络、安装、提权、环境修改或复杂 shell 语法' }
  }

  return { risk: 'ordinary' }
}

function isDynamicCommand(executable: string): boolean {
  return DYNAMIC_COMMANDS.has(executable)
}

function isHighRiskCommand(executable: string, args: string[]): boolean {
  if (HIGH_RISK_COMMANDS.has(executable)) {
    return true
  }
  if (executable === 'yarn' && args.length === 0) {
    return true
  }
  const installCommands = PACKAGE_INSTALL_COMMANDS[executable]
  return Boolean(installCommands && args.some(arg => installCommands.has(arg)))
}

function isLegacyHighRiskBlock(reason: string | undefined): boolean {
  return Boolean(reason?.startsWith('禁止命令:') || reason?.startsWith('禁止包安装:'))
}

function unwrapStaticCommand(
  executable: string,
  args: string[],
): { executable: string, args: string[] } | null {
  let currentExecutable = executable
  const currentArgs = [...args]

  for (let depth = 0; depth < 8; depth++) {
    if (DYNAMIC_COMMANDS.has(currentExecutable)) {
      return null
    }
    if (currentExecutable === 'sudo') {
      while (currentArgs[0]?.startsWith('-')) {
        currentArgs.shift()
      }
    }
    else if (currentExecutable === 'command') {
      if (currentArgs[0] === '--') {
        currentArgs.shift()
      }
    }
    else if (currentExecutable === 'env') {
      while (currentArgs.length > 0) {
        const current = currentArgs[0]
        if (current === '--') {
          currentArgs.shift()
          break
        }
        if (current.startsWith('-') || /^[A-Z_]\w*=/.test(current)) {
          currentArgs.shift()
          continue
        }
        break
      }
    }
    else {
      return { executable: currentExecutable, args: currentArgs }
    }

    const nextExecutable = currentArgs.shift()
    if (!nextExecutable) {
      return null
    }
    currentExecutable = path.basename(nextExecutable).toLowerCase()
  }
  return null
}

function findProtectedPosixDeleteTarget(
  args: string[],
  cwd: string,
  workspacePath: string,
  homePath: string | undefined,
  isMountPoint: (targetPath: string) => boolean,
): string | undefined {
  const targets = args.filter(arg => arg === '-' || !arg.startsWith('-'))
  for (const target of targets) {
    const normalizedExpression = target.replace(/\/+\*+$/u, '') || '/'
    const expanded = normalizedExpression === '~'
      ? (homePath || cwd)
      : normalizedExpression.startsWith('~/')
        ? path.join(homePath || cwd, normalizedExpression.slice(2))
        : normalizedExpression
    const resolved = resolveExistingPath(path.resolve(cwd, expanded))
    if (isProtectedPosixPath(resolved, workspacePath, homePath) || isMountPoint(resolved)) {
      return target
    }
  }
  return undefined
}

function isExistingMountPoint(targetPath: string): boolean {
  try {
    const parent = path.dirname(targetPath)
    return parent !== targetPath && fs.statSync(targetPath).dev !== fs.statSync(parent).dev
  }
  catch {
    return false
  }
}

function isProtectedPosixPath(
  targetPath: string,
  workspacePath: string,
  homePath: string | undefined,
): boolean {
  const protectedRoots = new Set([
    '/',
    '/Applications',
    '/Library',
    '/media',
    '/mnt',
    '/System',
    '/Users',
    '/bin',
    '/boot',
    '/dev',
    '/etc',
    '/home',
    '/opt',
    '/private',
    '/proc',
    '/root',
    '/run/media',
    '/sbin',
    '/sys',
    '/usr',
    '/var',
    '/Volumes',
    ...(homePath ? [resolveExistingPath(homePath)] : []),
    ...collectAncestors(resolveExistingPath(workspacePath)),
  ])
  if (protectedRoots.has(targetPath)) {
    return true
  }
  return false
}

function collectAncestors(filePath: string): string[] {
  const result: string[] = []
  let current = filePath
  while (true) {
    result.push(current)
    const parent = path.dirname(current)
    if (parent === current) {
      return result
    }
    current = parent
  }
}

function resolveExistingPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath)
  }
  catch {
    return path.resolve(filePath)
  }
}

function isAgentBrowser(executable: string, args: string[]): boolean {
  return executable === 'agent-browser'
    || (executable === 'npx' && args.includes('agent-browser'))
}
