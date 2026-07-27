import type { AvailableCommandHost, CommandInput, PreparedCommandSegment, PreparedCommandState } from './types'
import fs from 'node:fs'
import path from 'node:path'

export interface WindowsCommandFileSystem {
  /**
   * 将已存在路径、junction 和 8.3 短路径绑定到同一个真实身份。
   * 不存在的叶子由 boundary 原样返回，仍可用 win32 语义进行静态比较。
   */
  realpath: (targetPath: string) => string
}

export interface PrepareWindowsCommandOptions {
  blockAgentBrowser?: boolean
  fileSystem?: WindowsCommandFileSystem
  trustedPaths?: string[]
}

interface ParsedWindowsSegment {
  prepared: PreparedCommandSegment
  targets: string[]
  risk: PreparedCommandState['risk']
  riskReason?: string
}

const defaultFileSystem: WindowsCommandFileSystem = {
  realpath(targetPath) {
    try {
      return fs.realpathSync.native(targetPath)
    }
    catch {
      return targetPath
    }
  },
}

const POWERSHELL_DELETE_COMMANDS = new Set(['del', 'erase', 'rd', 'remove-item', 'ri', 'rm', 'rmdir'])
const POWERSHELL_CD_COMMANDS = new Set(['cd', 'chdir', 'set-location', 'sl'])
const CMD_DELETE_COMMANDS = new Set(['del', 'erase', 'rd', 'rmdir'])
const BOTTOMLINE_COMMANDS = new Set([
  'bcdedit',
  'bcdedit.exe',
  'bootrec',
  'bootrec.exe',
  'bootsect',
  'bootsect.exe',
  'diskpart',
  'diskpart.exe',
  'format',
  'format.com',
])
const APPROVAL_COMMANDS = new Set([
  'bitsadmin',
  'certutil',
  'choco',
  'copy',
  'curl',
  'copy-item',
  'invoke-restmethod',
  'Invoke-WebRequest'.toLowerCase(),
  'irm',
  'iwr',
  'install-module',
  'install-package',
  'move-item',
  'move',
  'net',
  'netsh',
  'new-item',
  'npm',
  'pip',
  'pip3',
  'pnpm',
  'reg',
  'runas',
  'scp',
  'set',
  'set-content',
  'set-executionpolicy',
  'set-item',
  'setx',
  'ssh',
  'start-bitstransfer',
  'winget',
  'wget',
  'yarn',
])
const POWERSHELL_READ_COMMANDS = new Set(['get-childitem', 'get-content', 'get-item', 'get-location'])
const CMD_READ_COMMANDS = new Set(['cd', 'dir', 'echo', 'type', 'ver', 'where'])
const POWERSHELL_PATH_READ_COMMANDS = new Set(['get-childitem', 'get-content', 'get-item'])
const CMD_PATH_READ_COMMANDS = new Set(['dir', 'type'])
const POWERSHELL_WRITE_COMMANDS = new Set(['copy-item', 'move-item', 'new-item', 'set-content', 'set-item'])
const CMD_WRITE_COMMANDS = new Set(['copy', 'move'])
const POWERSHELL_NON_PATH_VALUE_PARAMETERS = new Set([
  '-attributes',
  '-credential',
  '-delimiter',
  '-depth',
  '-encoding',
  '-exclude',
  '-filter',
  '-include',
  '-readcount',
  '-stream',
  '-tail',
  '-totalcount',
])

export function prepareWindowsCommand(
  input: CommandInput,
  workspacePath: string,
  host: AvailableCommandHost,
  options: PrepareWindowsCommandOptions = {},
): PreparedCommandState {
  assertWindowsHost(host)
  const fileSystem = options.fileSystem ?? defaultFileSystem
  const canonicalWorkspace = canonicalizePath(workspacePath, workspacePath, host.environment, fileSystem)
  const resourceRoots = [
    canonicalWorkspace,
    ...(options.trustedPaths ?? []).map(trustedPath =>
      canonicalizePath(trustedPath, canonicalWorkspace, host.environment, fileSystem)),
  ]
  const canonicalCwd = canonicalizePath(input.cwd || workspacePath, canonicalWorkspace, host.environment, fileSystem)
  const hasSecretEnv = Boolean(input.secretEnv && Object.keys(input.secretEnv).length > 0)
  const parsed = host.interpreter === 'cmd'
    ? parseCmd(input.command, canonicalCwd, canonicalWorkspace, resourceRoots, host, fileSystem, options.blockAgentBrowser)
    : parsePowerShell(input.command, canonicalCwd, canonicalWorkspace, resourceRoots, host, fileSystem, options.blockAgentBrowser)
  const parsedRisk = parsed.reduce<PreparedCommandState['risk']>(
    (current, segment) => maxRisk(current, segment.risk),
    'ordinary',
  )
  const risk = hasSecretEnv ? maxRisk(parsedRisk, 'requires_approval') : parsedRisk
  const resourceScope = parsed.every(segment => segment.prepared.resourceScope === 'workspace')
    ? 'workspace'
    : 'outside'

  return {
    kind: 'command',
    interpreter: host.interpreter,
    input,
    command: input.command,
    cwd: canonicalCwd,
    segments: parsed.map(segment => segment.prepared),
    resourceScope,
    isReadOnly: risk === 'ordinary' && !hasSecretEnv && parsed.length > 0 && parsed.every(segment => segment.prepared.isReadOnly),
    hasSecretEnv,
    risk,
    riskReason: parsed.find(segment => segment.risk === risk)?.riskReason
      ?? (hasSecretEnv && risk === 'requires_approval' ? '秘密注入需要审批' : undefined),
    executionPlan: {
      executablePath: host.executablePath,
      args: host.interpreter === 'cmd'
        ? ['/d', '/s', '/c', input.command]
        : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', input.command],
      cwd: canonicalCwd,
      environment: host.environment,
    },
    adapterState: {
      segments: parsed.map(segment => ({
        targets: segment.targets,
        risk: segment.risk,
        riskReason: segment.riskReason,
      })),
    },
  }
}

function parsePowerShell(
  command: string,
  cwd: string,
  workspacePath: string,
  resourceRoots: string[],
  host: AvailableCommandHost,
  fileSystem: WindowsCommandFileSystem,
  blockAgentBrowser = false,
): ParsedWindowsSegment[] {
  const commands = splitPowerShellSemicolon(command)
  if (!commands)
    return [blockedSegment(command, cwd, 'PowerShell 命令串无法可靠解析')]

  const result: ParsedWindowsSegment[] = []
  let currentCwd = cwd
  for (const rawCommand of commands) {
    const environmentAssignment = parseStaticPowerShellEnvironmentAssignment(rawCommand)
    if (environmentAssignment) {
      result.push({
        prepared: createPreparedSegment(
          `$env:${environmentAssignment.name.toLowerCase()}`,
          ['='],
          currentCwd,
          false,
          resourceRoots,
        ),
        targets: [],
        risk: 'requires_approval',
        riskReason: '环境变量修改需要单次审批',
      })
      continue
    }

    const dynamicReason = findPowerShellDynamicStructure(rawCommand)
    if (dynamicReason)
      return [blockedSegment(rawCommand, currentCwd, dynamicReason)]

    const expanded = expandPowerShellTokens(tokenize(rawCommand), host.environment)
    if (expanded.error)
      return [blockedSegment(rawCommand, currentCwd, expanded.error)]
    const tokens = expanded.tokens
    if (tokens.length === 0)
      return [blockedSegment(rawCommand, currentCwd, '命令为空')]

    const executable = basename(tokens[0])
    if (BOTTOMLINE_COMMANDS.has(executable))
      return [blockedSegment(rawCommand, currentCwd, `禁止直接执行磁盘或启动配置破坏命令：${executable}`)]
    if (blockAgentBrowser && isAgentBrowserCommand(executable, tokens.slice(1)))
      return [blockedSegment(rawCommand, currentCwd, '命令不得绕过 Browser 工具直接启动 agent-browser')]
    if (POWERSHELL_CD_COMMANDS.has(executable)) {
      const targets = collectPowerShellReadTargets(tokens.slice(1))
      if (targets.length !== 1)
        return [blockedSegment(rawCommand, currentCwd, 'Set-Location 只接受一个静态目录')]
      currentCwd = canonicalizePath(targets[0]!, currentCwd, host.environment, fileSystem)
      result.push({
        prepared: {
          executable,
          args: tokens.slice(1),
          cwd: currentCwd,
          isCd: true,
          isReadOnly: true,
          resourceScope: isInsideAnyPath(resourceRoots, currentCwd) ? 'workspace' : 'outside',
        },
        targets: [currentCwd],
        risk: 'ordinary',
      })
      continue
    }
    if (isScript(executable))
      return [blockedSegment(rawCommand, currentCwd, '脚本内容无法在执行前可靠验证')]
    if (['cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(executable)) {
      return [blockedSegment(rawCommand, currentCwd, '嵌套命令解释器无法证明授权对象等于执行对象')]
    }

    if (POWERSHELL_DELETE_COMMANDS.has(executable)) {
      const targets = collectPowerShellTargets(tokens.slice(1))
      result.push(classifyDeletion(
        rawCommand,
        executable,
        tokens.slice(1),
        targets,
        currentCwd,
        workspacePath,
        resourceRoots,
        host,
        fileSystem,
      ))
      continue
    }

    const rawTargets = POWERSHELL_PATH_READ_COMMANDS.has(executable)
      ? collectPowerShellReadTargets(tokens.slice(1))
      : POWERSHELL_WRITE_COMMANDS.has(executable)
        ? collectPowerShellWriteTargets(executable, tokens.slice(1))
        : []
    const targets = canonicalizeReadTargets(rawTargets, currentCwd, host.environment, fileSystem)
    const needsApproval = APPROVAL_COMMANDS.has(executable)
    result.push({
      prepared: createPreparedSegment(
        executable,
        tokens.slice(1),
        currentCwd,
        POWERSHELL_READ_COMMANDS.has(executable),
        resourceRoots,
        targets,
      ),
      targets,
      risk: needsApproval ? 'requires_approval' : 'ordinary',
      riskReason: needsApproval ? `高风险命令需要审批：${executable}` : undefined,
    })
  }
  return result
}

function parseCmd(
  command: string,
  initialCwd: string,
  workspacePath: string,
  resourceRoots: string[],
  host: AvailableCommandHost,
  fileSystem: WindowsCommandFileSystem,
  blockAgentBrowser = false,
): ParsedWindowsSegment[] {
  const expanded = expandCmdEnvironment(command, host.environment, initialCwd)
  const dynamicReason = expanded.error ?? findCmdDynamicStructure(expanded.value)
  if (dynamicReason)
    return [blockedSegment(command, initialCwd, dynamicReason)]

  const commands = splitCmdAndAnd(expanded.value)
  if (!commands)
    return [blockedSegment(command, initialCwd, 'CMD 命令串无法可靠解析')]

  const result: ParsedWindowsSegment[] = []
  let cwd = initialCwd
  for (const rawCommand of commands) {
    const tokens = tokenize(rawCommand)
    if (tokens.length === 0)
      return [blockedSegment(command, cwd, '命令为空')]
    const executable = basename(tokens[0])

    if (BOTTOMLINE_COMMANDS.has(executable))
      return [blockedSegment(rawCommand, cwd, `禁止直接执行磁盘或启动配置破坏命令：${executable}`)]
    if (blockAgentBrowser && isAgentBrowserCommand(executable, tokens.slice(1)))
      return [blockedSegment(rawCommand, cwd, '命令不得绕过 Browser 工具直接启动 agent-browser')]

    if (executable === 'cd' || executable === 'chdir') {
      const cdArgs = tokens.slice(1).filter(token => token.toLowerCase() !== '/d')
      if (cdArgs.length !== 1)
        return [blockedSegment(rawCommand, cwd, 'cd /d 只接受一个静态目录')]
      cwd = canonicalizePath(cdArgs[0], cwd, host.environment, fileSystem)
      result.push({
        prepared: {
          executable,
          args: tokens.slice(1),
          cwd,
          isCd: true,
          isReadOnly: true,
          resourceScope: isInsideAnyPath(resourceRoots, cwd) ? 'workspace' : 'outside',
        },
        targets: [cwd],
        risk: 'ordinary',
      })
      continue
    }

    if (isScript(executable) || executable === 'call')
      return [blockedSegment(rawCommand, cwd, '脚本内容无法在执行前可靠验证')]
    if (['cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(executable)) {
      return [blockedSegment(rawCommand, cwd, '嵌套命令解释器无法证明授权对象等于执行对象')]
    }

    if (CMD_DELETE_COMMANDS.has(executable)) {
      const targets = tokens.slice(1).filter(token => !isCmdOption(token))
      result.push(classifyDeletion(
        rawCommand,
        executable,
        tokens.slice(1),
        targets,
        cwd,
        workspacePath,
        resourceRoots,
        host,
        fileSystem,
      ))
      continue
    }

    const needsApproval = APPROVAL_COMMANDS.has(executable)
    const whereTargets = executable === 'where' ? collectCmdWhereTargets(tokens.slice(1)) : undefined
    if (whereTargets?.error)
      return [blockedSegment(rawCommand, cwd, whereTargets.error)]
    const rawTargets = whereTargets
      ? whereTargets.targets
      : CMD_PATH_READ_COMMANDS.has(executable) || CMD_WRITE_COMMANDS.has(executable)
        ? tokens.slice(1).filter(token => !isCmdOption(token))
        : []
    const targets = canonicalizeReadTargets(rawTargets, cwd, host.environment, fileSystem)
    result.push({
      prepared: createPreparedSegment(
        executable,
        tokens.slice(1),
        cwd,
        CMD_READ_COMMANDS.has(executable),
        resourceRoots,
        targets,
      ),
      targets,
      risk: needsApproval ? 'requires_approval' : 'ordinary',
      riskReason: needsApproval ? `高风险命令需要审批：${executable}` : undefined,
    })
  }
  return result
}

function classifyDeletion(
  rawCommand: string,
  executable: string,
  args: string[],
  rawTargets: string[],
  cwd: string,
  workspacePath: string,
  resourceRoots: string[],
  host: AvailableCommandHost,
  fileSystem: WindowsCommandFileSystem,
): ParsedWindowsSegment {
  if (rawTargets.length === 0)
    return blockedSegment(rawCommand, cwd, '删除命令缺少可静态验证的目标')

  const targets = rawTargets.map(target => canonicalizeTarget(target, cwd, host.environment, fileSystem))
  const protectedRoots = createProtectedRoots(workspacePath, host.environment, fileSystem)
  const blockedTarget = targets.find(target => isBottomlineTarget(target, protectedRoots))
  const resourceScope = targets.every(target => isInsideAnyPath(resourceRoots, target.path))
    && isInsideAnyPath(resourceRoots, cwd)
    ? 'workspace'
    : 'outside'

  return {
    prepared: {
      executable,
      args,
      cwd,
      isCd: false,
      isReadOnly: false,
      resourceScope,
    },
    targets: targets.map(target => target.path),
    risk: blockedTarget ? 'bottomline_block' : 'requires_approval',
    riskReason: blockedTarget
      ? `禁止删除受保护根或其全部内容：${blockedTarget.path}`
      : '删除命令需要审批',
  }
}

function collectPowerShellTargets(args: string[]): string[] {
  const targets: string[] = []
  for (const arg of args) {
    if (!arg.startsWith('-'))
      targets.push(arg.replace(/,$/u, ''))
  }
  return targets
}

function collectPowerShellReadTargets(args: string[]): string[] {
  const targets: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    const parameter = arg.toLowerCase()
    const inlinePath = arg.match(/^-(?:Literal)?Path:(.+)$/iu)
    if (inlinePath) {
      targets.push(inlinePath[1]!.replace(/,$/u, ''))
      continue
    }
    if (parameter === '-path' || parameter === '-literalpath') {
      const target = args[index + 1]
      if (target && !target.startsWith('-')) {
        targets.push(target.replace(/,$/u, ''))
        index++
      }
      continue
    }
    if (POWERSHELL_NON_PATH_VALUE_PARAMETERS.has(parameter)) {
      index++
      continue
    }
    if (!arg.startsWith('-'))
      targets.push(arg.replace(/,$/u, ''))
  }
  return targets
}

function collectPowerShellWriteTargets(executable: string, args: string[]): string[] {
  const explicitTargets: string[] = []
  const positional: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    const inlineTarget = arg.match(/^-(?:Destination|LiteralPath|Path):(.+)$/iu)
    if (inlineTarget) {
      explicitTargets.push(inlineTarget[1]!)
      continue
    }
    const parameter = arg.toLowerCase()
    if (parameter === '-destination' || parameter === '-path' || parameter === '-literalpath') {
      const target = args[index + 1]
      if (target && !target.startsWith('-')) {
        explicitTargets.push(target)
        index++
      }
      continue
    }
    if (parameter === '-value') {
      index++
      continue
    }
    if (!arg.startsWith('-'))
      positional.push(arg)
  }
  if (executable === 'new-item' || executable === 'set-content' || executable === 'set-item')
    return explicitTargets.length > 0 ? explicitTargets : positional.slice(0, 1)
  return [...explicitTargets, ...positional]
}

function canonicalizeReadTargets(
  rawTargets: string[],
  cwd: string,
  environment: Record<string, string>,
  fileSystem: WindowsCommandFileSystem,
): string[] {
  return rawTargets.map(target => canonicalizePath(target, cwd, environment, fileSystem))
}

function collectCmdWhereTargets(args: string[]): { targets: string[], error?: string } {
  if (args.some(arg => /^\/r:/iu.test(arg)))
    return { targets: [], error: 'where /r 只接受独立的静态目录参数' }

  const recursiveIndexes = args
    .map((arg, index) => arg.toLowerCase() === '/r' ? index : -1)
    .filter(index => index >= 0)
  if (recursiveIndexes.length === 0)
    return { targets: [] }
  if (recursiveIndexes.length !== 1)
    return { targets: [], error: 'where /r 只能指定一次静态搜索目录' }

  const recursiveIndex = recursiveIndexes[0]!
  const directory = args[recursiveIndex + 1]
  const patterns = args.slice(recursiveIndex + 2).filter(arg => !isCmdOption(arg))
  if (!directory || isCmdOption(directory) || patterns.length === 0)
    return { targets: [], error: 'where /r 必须同时提供静态搜索目录和文件 pattern' }
  if (/[*?]/u.test(directory))
    return { targets: [], error: 'where /r 的搜索目录不能包含动态通配符' }
  return { targets: [directory] }
}

function createPreparedSegment(
  executable: string,
  args: string[],
  cwd: string,
  isReadOnly: boolean,
  resourceRoots: string[],
  targets: string[] = [],
): PreparedCommandSegment {
  return {
    executable,
    args,
    cwd,
    isCd: false,
    isReadOnly,
    resourceScope: isInsideAnyPath(resourceRoots, cwd)
      && targets.every(target => isInsideAnyPath(resourceRoots, target))
      ? 'workspace'
      : 'outside',
  }
}

function blockedSegment(rawCommand: string, cwd: string, reason: string): ParsedWindowsSegment {
  const tokens = tokenize(rawCommand)
  return {
    prepared: {
      executable: tokens[0] ? basename(tokens[0]) : '',
      args: tokens.slice(1),
      cwd,
      isCd: false,
      isReadOnly: false,
      resourceScope: 'outside',
    },
    targets: [],
    risk: 'bottomline_block',
    riskReason: reason,
  }
}

function expandPowerShellTokens(
  tokens: string[],
  environment: Record<string, string>,
): { tokens: string[], error?: string } {
  let error: string | undefined
  const expanded = tokens.map((token) => {
    return token.replace(/\$env:([A-Z_][\w()]*)/giu, (_match, name: string) => {
      const resolved = getEnvironmentValue(environment, name)
      if (resolved === undefined) {
        error = `无法静态展开环境变量：${name}`
        return _match
      }
      return resolved
    })
  })
  return { tokens: expanded, error }
}

function expandCmdEnvironment(
  command: string,
  environment: Record<string, string>,
  cwd: string,
): { value: string, error?: string } {
  let error: string | undefined
  const value = command.replace(/%([^%]+)%/gu, (_match, name: string) => {
    if (name.toLowerCase() === 'cd')
      return cwd
    const resolved = getEnvironmentValue(environment, name)
    if (resolved === undefined) {
      error = `无法静态展开环境变量：${name}`
      return _match
    }
    return resolved
  })
  return { value, error }
}

function findPowerShellDynamicStructure(command: string): string | undefined {
  if (/\$env:[A-Z_][\w()]*\s*=/iu.test(command))
    return 'PowerShell 环境变量赋值无法证明受控执行环境'
  if (/[\r\n]/u.test(command))
    return 'PowerShell 动态或复合结构无法证明授权对象等于执行对象'
  if (hasUnquotedPowerShellOperator(command))
    return 'PowerShell 动态或复合结构无法证明授权对象等于执行对象'
  if (/\$\(|@\(|`/u.test(command))
    return 'PowerShell 动态或复合结构无法证明授权对象等于执行对象'
  if (/(?:^|\s)(?:Invoke-Expression|iex|Start-Process)\b/iu.test(command))
    return 'PowerShell 动态执行结构无法可靠验证'
  if (/\$(?!env:)[A-Z_{]/iu.test(command))
    return 'PowerShell 动态变量无法可靠验证'
  return undefined
}

function parseStaticPowerShellEnvironmentAssignment(command: string): { name: string } | undefined {
  const normalized = command.trim()
  const match = normalized.match(/^\$env:([A-Z_]\w*)[ \t]*=/iu)
  if (!match)
    return undefined
  const value = normalized.slice(match[0].length).trim()
  const isStaticSingleQuoted = /^'(?:[^']|'')*'$/u.test(value)
  const isStaticDoubleQuoted = /^"[^"$`]*"$/u.test(value)
  const isStaticBare = /^[^\s$`"'(){};&|<>,]+$/u.test(value)
  return isStaticSingleQuoted || isStaticDoubleQuoted || isStaticBare
    ? { name: match[1]! }
    : undefined
}

function hasUnquotedPowerShellOperator(command: string): boolean {
  let quote: '"' | '\'' | undefined
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (quote) {
      if (quote === '"' && char === '`') {
        index++
        continue
      }
      if (char === quote) {
        if (quote === '\'' && command[index + 1] === '\'')
          index++
        else
          quote = undefined
      }
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      continue
    }
    if (char === '&' || char === '|' || char === '<' || char === '>' || char === ',')
      return true
  }
  return false
}

function splitPowerShellSemicolon(command: string): string[] | undefined {
  const result: string[] = []
  let current = ''
  let quote: '"' | '\'' | undefined

  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (quote) {
      current += char
      if (quote === '"' && char === '`') {
        const escaped = command[index + 1]
        if (escaped !== undefined) {
          current += escaped
          index++
        }
        continue
      }
      if (char === quote) {
        if (quote === '\'' && command[index + 1] === '\'') {
          current += command[index + 1]
          index++
        }
        else {
          quote = undefined
        }
      }
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      current += char
      continue
    }
    if (char === ';') {
      if (!current.trim())
        return undefined
      result.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  if (quote || !current.trim())
    return undefined
  result.push(current.trim())
  return result
}

function findCmdDynamicStructure(command: string): string | undefined {
  if (/[\r\n]/u.test(command) || /[|<>^()]|(?<!&)&(?!&)/u.test(command))
    return 'CMD 动态或复合结构无法证明授权对象等于执行对象'
  if (/%[^%]+%/u.test(command) || /![^!]+!/u.test(command))
    return 'CMD 动态变量无法可靠验证'
  return undefined
}

function splitCmdAndAnd(command: string): string[] | undefined {
  const result: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (char === '"') {
      quoted = !quoted
      current += char
      continue
    }
    if (!quoted && char === '&' && command[index + 1] === '&') {
      if (!current.trim())
        return undefined
      result.push(current.trim())
      current = ''
      index++
      continue
    }
    current += char
  }
  if (quoted || !current.trim())
    return undefined
  result.push(current.trim())
  return result
}

function tokenize(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/gu)?.map(token => token.replace(/^(['"])|(['"])$/gu, '')) ?? []
}

function canonicalizeTarget(
  rawTarget: string,
  cwd: string,
  environment: Record<string, string>,
  fileSystem: WindowsCommandFileSystem,
): { path: string, coversAll: boolean, device: boolean, unresolvedWildcard: boolean } {
  const normalizedTarget = stripPowerShellFileSystemProvider(rawTarget).replace(/\//gu, '\\')
  const device = isDevicePath(normalizedTarget)
  const { base, coversAll } = stripFullCoverage(normalizedTarget)
  return {
    path: canonicalizePath(base, cwd, environment, fileSystem),
    coversAll,
    device,
    unresolvedWildcard: /[*?]/u.test(normalizedTarget) && !coversAll,
  }
}

function canonicalizePath(
  inputPath: string,
  cwd: string,
  environment: Record<string, string>,
  fileSystem: WindowsCommandFileSystem,
): string {
  const expanded = expandKnownWindowsVariables(stripPowerShellFileSystemProvider(inputPath), environment)
  const withoutExtendedPrefix = normalizeExtendedPrefix(expanded)
  const resolved = path.win32.isAbsolute(withoutExtendedPrefix)
    ? path.win32.normalize(withoutExtendedPrefix)
    : path.win32.resolve(cwd, withoutExtendedPrefix)
  try {
    return trimTrailingSeparator(path.win32.normalize(fileSystem.realpath(resolved)))
  }
  catch {
    return trimTrailingSeparator(resolved)
  }
}

function stripPowerShellFileSystemProvider(value: string): string {
  return value.replace(/^(?:Microsoft\.PowerShell\.Core\\)?FileSystem::/iu, '')
}

function expandKnownWindowsVariables(value: string, environment: Record<string, string>): string {
  return value
    .replace(/\$env:([A-Z_][\w()]*)/giu, (match, name: string) => getEnvironmentValue(environment, name) ?? match)
    .replace(/%([^%]+)%/gu, (match, name: string) => getEnvironmentValue(environment, name) ?? match)
}

function normalizeExtendedPrefix(value: string): string {
  if (/^\\\\\?\\UNC\\/iu.test(value))
    return `\\\\${value.slice(8)}`
  if (/^\\\\\?\\[A-Z]:\\/iu.test(value))
    return value.slice(4)
  return value
}

function stripFullCoverage(target: string): { base: string, coversAll: boolean } {
  const match = target.match(/^(.*\\)([*?]+(?:\.[*?]+)?)$/u)
  const coversAll = Boolean(match?.[2]?.includes('*'))
  return match
    ? { base: match[1], coversAll }
    : { base: target, coversAll: false }
}

function createProtectedRoots(
  workspacePath: string,
  environment: Record<string, string>,
  fileSystem: WindowsCommandFileSystem,
): Set<string> {
  const roots = new Set<string>()
  const add = (candidate: string | undefined) => {
    if (!candidate)
      return
    roots.add(compareKey(canonicalizePath(candidate, workspacePath, environment, fileSystem)))
  }

  add(environment.SystemRoot)
  add(getEnvironmentValue(environment, 'ProgramFiles'))
  add(getEnvironmentValue(environment, 'ProgramFiles(x86)'))
  add(environment.ProgramData)
  add(environment.USERPROFILE)
  const userProfile = environment.USERPROFILE
  if (userProfile)
    add(path.win32.dirname(userProfile))

  let current = canonicalizePath(workspacePath, workspacePath, environment, fileSystem)
  while (true) {
    add(current)
    const parent = path.win32.dirname(current)
    if (compareKey(parent) === compareKey(current))
      break
    current = parent
  }
  return roots
}

function isBottomlineTarget(
  target: { path: string, coversAll: boolean, device: boolean, unresolvedWildcard: boolean },
  protectedRoots: Set<string>,
): boolean {
  if (target.device || target.unresolvedWildcard)
    return true
  const targetKey = compareKey(target.path)
  const parsedRoot = compareKey(path.win32.parse(target.path).root)
  if (targetKey === parsedRoot)
    return true
  return protectedRoots.has(targetKey)
}

function isInsidePath(rootPath: string, candidatePath: string): boolean {
  const relative = path.win32.relative(compareKey(rootPath), compareKey(candidatePath))
  return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative))
}

function isInsideAnyPath(rootPaths: string[], candidatePath: string): boolean {
  return rootPaths.some(rootPath => isInsidePath(rootPath, candidatePath))
}

function isAgentBrowserCommand(executable: string, args: string[]): boolean {
  if (executable === 'agent-browser')
    return true
  const normalizedArgs = args.map(arg => arg.toLowerCase())
  if (executable === 'npx')
    return normalizedArgs.includes('agent-browser')
  if (executable === 'pnpm')
    return normalizedArgs[0] === 'exec' && normalizedArgs[1] === 'agent-browser'
  return false
}

function isDevicePath(targetPath: string): boolean {
  return /^\\\\[.?]\\(?:PhysicalDrive|GLOBALROOT|Device|Volume\{)/iu.test(targetPath)
}

function isCmdOption(token: string): boolean {
  return /^\/-?[A-Z]+(?::.*)?$/iu.test(token) && !/^[A-Z]:[\\/]/iu.test(token)
}

function isScript(executable: string): boolean {
  return /\.(?:bat|cmd|ps1)$/iu.test(executable)
}

function basename(executable: string): string {
  return path.win32.basename(executable).toLowerCase()
}

function compareKey(value: string): string {
  return trimTrailingSeparator(path.win32.normalize(value)).toLocaleLowerCase('en-US')
}

function trimTrailingSeparator(value: string): string {
  const root = path.win32.parse(value).root
  return compareRawPath(value, root) ? root : value.replace(/\\+$/u, '')
}

function compareRawPath(left: string, right: string): boolean {
  return left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
}

function getEnvironmentValue(environment: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(environment).find(candidate => candidate.toLowerCase() === name.toLowerCase())
  return key ? environment[key] : undefined
}

function maxRisk(
  left: PreparedCommandState['risk'],
  right: PreparedCommandState['risk'],
): PreparedCommandState['risk'] {
  const rank: Record<PreparedCommandState['risk'], number> = {
    ordinary: 0,
    requires_approval: 1,
    bottomline_block: 2,
  }
  return rank[right] > rank[left] ? right : left
}

function assertWindowsHost(host: AvailableCommandHost): void {
  if (
    host.status !== 'available'
    || host.platform !== 'windows'
    || host.adapter !== 'windows'
    || !['powershell7', 'windows-powershell', 'cmd'].includes(host.interpreter)
  ) {
    throw new Error('prepareWindowsCommand 只接受可用的 Windows Command Host')
  }
}
