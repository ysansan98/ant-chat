import type { CommandRule, CommandSegmentCandidate, CommandToolInput } from '@ant-chat/shared'
import type { PathPolicy } from '../pathPolicy'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createPathPolicyByMode } from '../pathPolicy'

/**
 * Bash 命令的 canonical 解析结果。
 *
 * 所有消费方——scope 推导、硬阻断、command_read 判定、规则候选、规则匹配和最终执行——
 * 必须消费同一份解析结果，禁止各自重新用字符串或正则猜测命令。
 *
 * 详见 docs/adr/0001-tool-approval-rules.md §5。
 */

// ---- 禁止命令族（按 basename 与解析后可执行文件共同识别）----

const FORBIDDEN_COMMANDS = new Set([
  'rm',
  'sudo',
  'curl',
  'wget',
  'ssh',
  'scp',
  'env',
  'export',
  'declare',
  'typeset',
  'set',
  'unset',
  'readonly',
  'command',
  'builtin',
  'exec',
  'eval',
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

const SHELL_CONTROL_WORDS = new Set([
  'if',
  'then',
  'elif',
  'else',
  'fi',
  'for',
  'while',
  'until',
  'case',
  'esac',
  'select',
  'do',
  'done',
  'function',
])

/**
 * 无法安全结构化授权的 shell 语法。
 *
 * 它们不是硬阻断：交互 Turn 必须逐次请求用户审批，且不能生成持久白名单。
 * 真正的禁止命令族仍由 checkHardBlock 裁决。
 */
/** git 只读子命令及其安全参数校验 */
const GIT_READ_ONLY_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show'])

/** git 参数中拒绝的写文件/执行外部程序的选项 */
const GIT_FORBIDDEN_ARGS = ['--output', '--ext-diff', '--textconv']

export interface ParsedBashSegment {
  /** 原始命令文本（仅展示） */
  rawCommand: string
  /** 用户输入的可执行文件名 */
  command: string
  /** 命令 basename（小写），用于黑白名单识别 */
  executableBasename: string
  /** 参数（不含可执行文件本身） */
  args: string[]
  /** 该段实际执行时使用的 canonical cwd */
  cwd: string
  /** 该段是否为 cd（只改变上下文，不生成规则） */
  isCd: boolean
  /** 该段是否被硬阻断 */
  isHardBlocked: boolean
  /** 硬阻断原因 */
  blockReason?: string
  /** 该段是否为只读命令 */
  isReadOnly: boolean
  /** 该段涉及的路径参数是否在工作区内 */
  isInsideWorkspace: boolean
  /** 该段执行上下文与可见路径参数形成的资源边界 */
  resourceScope: 'workspace' | 'outside'
}

export interface ParsedBashCommand {
  /** 输入命令文本 */
  command: string
  /** 仅供权限分析的 `&&` 段；最终执行不得把它当作进程执行计划 */
  segments: ParsedBashSegment[]
  /** 调用入口的 canonical cwd */
  cwd: string
  /** prepare 时固定、供可执行文件解析与最终执行共同使用的 PATH */
  executableSearchPath: string | undefined
  /** 是否通过专用通道注入 SecretRef */
  hasSecretEnv: boolean
  /** 是否包含只能单次审批执行的 shell 语法 */
  hasShellSyntax: boolean
  /** 是否被硬阻断（任何一段命中禁止命令或输入无效） */
  isBlocked: boolean
  /** 硬阻断原因 */
  blockReason?: string
  /** 资源边界 */
  resourceScope: 'workspace' | 'outside'
  /** 是否整体为只读 */
  isReadOnly: boolean
  /** 原始 input */
  input: CommandToolInput
}

export interface BashParseOptions {
  executableSearchPath?: string
  trustedPaths?: string[]
  blockAgentBrowser?: boolean
}

export interface PreparedBashToolState {
  kind: 'bash'
  parsed: ParsedBashCommand
}

export function isPreparedBashToolState(value: unknown): value is PreparedBashToolState {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<PreparedBashToolState>
  return candidate.kind === 'bash' && Boolean(candidate.parsed)
}

/**
 * 解析 Bash 工具输入，生成 canonical 结果。
 *
 * 此函数是所有 Bash 相关逻辑的唯一解析入口。解析结果包含：
 * - 引号感知的 `&&` 分段
 * - 受控 PATH 解析的可执行文件
 * - scope 推导（workspace/outside）
 * - 硬阻断判定
 * - command_read 只读判定
 */
export function parseBashCommand(
  input: CommandToolInput,
  workspacePath: string,
  options: BashParseOptions = {},
): ParsedBashCommand {
  const hasSecretEnv = Boolean(input.secretEnv && Object.keys(input.secretEnv).length > 0)
  const policy = createPathPolicyByMode(workspacePath, 'workspace', options.trustedPaths)
  const executableSearchPath = options.executableSearchPath ?? process.env.PATH ?? process.env.Path

  const cwd = resolveShellPath(input.cwd || '.', workspacePath)
  const canonicalCwd = resolveRealPathIfPresent(cwd)
  const cwdIsDirectory = isDirectory(canonicalCwd)
  const cwdInsideWorkspace = cwdIsDirectory && policy.isInsideWorkspace(canonicalCwd)
  const unverifiableShellStructure = findUnverifiableShellStructure(input.command)
  if (unverifiableShellStructure) {
    return {
      command: input.command,
      segments: [],
      cwd: canonicalCwd,
      executableSearchPath,
      hasSecretEnv,
      hasShellSyntax: true,
      isBlocked: true,
      blockReason: `命令包含无法可靠校验的 shell 结构：${unverifiableShellStructure}`,
      resourceScope: 'outside',
      isReadOnly: false,
      input,
    }
  }
  const inlineEnvironmentVariable = findInlineEnvironmentVariable(input.command)
  if (inlineEnvironmentVariable) {
    return {
      command: input.command,
      segments: [],
      cwd: canonicalCwd,
      executableSearchPath,
      hasSecretEnv,
      hasShellSyntax: true,
      isBlocked: true,
      blockReason: `不允许在命令文本中设置环境变量 ${inlineEnvironmentVariable}，秘密只能通过 secretEnv 注入`,
      resourceScope: 'outside',
      isReadOnly: false,
      input,
    }
  }

  // shell 语法无法生成稳定的结构化授权规则，但由用户单次审批决定是否执行。
  if (hasUnsupportedShellSyntax(input.command)) {
    // 仍尽可能提取命令段，以便内置禁止命令和用户黑名单能优先命中。
    let segments: ParsedBashSegment[]
    try {
      const rawSegments = parseShellCommandSegments(input.command)
      segments = parseSegments(rawSegments, canonicalCwd, policy, options.blockAgentBrowser)
    }
    catch {
      return {
        command: input.command,
        segments: [],
        cwd: canonicalCwd,
        executableSearchPath,
        hasSecretEnv,
        hasShellSyntax: true,
        isBlocked: true,
        blockReason: '命令语法无法解析',
        resourceScope: 'outside',
        isReadOnly: false,
        input,
      }
    }
    // 只有命令本身命中硬阻断才直接拒绝；其余语法交由人工审批。
    const blockedSegment = segments.find(s => s.isHardBlocked)
    if (blockedSegment) {
      return {
        command: input.command,
        segments,
        cwd: canonicalCwd,
        executableSearchPath,
        hasSecretEnv,
        hasShellSyntax: true,
        isBlocked: true,
        blockReason: blockedSegment.blockReason,
        resourceScope: 'outside',
        isReadOnly: false,
        input,
      }
    }
    return {
      command: input.command,
      segments,
      cwd: canonicalCwd,
      executableSearchPath,
      hasSecretEnv,
      hasShellSyntax: true,
      isBlocked: false,
      // 对未结构化 shell 输入保守视为工作区外；审批后使用 shell 执行原始命令。
      resourceScope: 'outside',
      isReadOnly: false,
      input,
    }
  }

  // 解析命令段
  let rawSegments: Array<{ command: string, args: string[] }>
  try {
    rawSegments = parseCommandSegments(input.command)
  }
  catch {
    return {
      command: input.command,
      segments: [],
      cwd: canonicalCwd,
      executableSearchPath,
      hasSecretEnv,
      hasShellSyntax: false,
      isBlocked: true,
      blockReason: '命令语法无法解析',
      resourceScope: 'outside',
      isReadOnly: false,
      input,
    }
  }

  if (rawSegments.length === 0) {
    return {
      command: input.command,
      segments: [],
      cwd: canonicalCwd,
      executableSearchPath,
      hasSecretEnv,
      hasShellSyntax: false,
      isBlocked: true,
      blockReason: '命令为空',
      resourceScope: 'outside',
      isReadOnly: false,
      input,
    }
  }

  const segments = parseSegments(rawSegments, canonicalCwd, policy, options.blockAgentBrowser)

  if (!cwdIsDirectory) {
    return {
      command: input.command,
      segments,
      cwd: canonicalCwd,
      executableSearchPath,
      hasSecretEnv,
      hasShellSyntax: false,
      isBlocked: true,
      blockReason: '工作目录不存在或不是目录',
      resourceScope: 'outside',
      isReadOnly: false,
      input,
    }
  }

  const blockedSegment = segments.find(s => s.isHardBlocked)
  const isBlocked = Boolean(blockedSegment)

  // scope 推导：所有段在工作区内且不被阻断 → workspace
  // cwd 在工作区外时，整体视为 outside
  const allInside = segments.every(s => s.isInsideWorkspace)
  const resourceScope: 'workspace' | 'outside' = (allInside && cwdInsideWorkspace) ? 'workspace' : 'outside'

  // command_read 判定：SecretRef 注入可能改变解释器行为，因此不可能是只读。
  // 所有段都是只读命令且参数安全
  const isReadOnly = !hasSecretEnv && !isBlocked && segments.every(s => s.isReadOnly)

  return {
    command: input.command,
    segments,
    cwd: canonicalCwd,
    executableSearchPath,
    hasSecretEnv,
    hasShellSyntax: false,
    isBlocked,
    blockReason: blockedSegment?.blockReason,
    resourceScope,
    isReadOnly,
    input,
  }
}

/**
 * 引号感知的 `&&` 分段。
 * 引号内的 `&&` 不是分隔符。
 */
export function parseCommandSegments(command: string): Array<{ command: string, args: string[] }> {
  const segments = splitByAndAnd(command)
  if (segments.length === 0) {
    throw new Error('bash command is blocked')
  }
  return segments.map(parseSingleCommand)
}

/**
 * 为黑名单识别提取复杂 shell 输入中的可执行命令段。
 * 不把结果用于执行或白名单授权；真正执行始终使用原始命令文本。
 */
function parseShellCommandSegments(command: string): Array<{ command: string, args: string[] }> {
  const segments = splitByShellOperators(command)
  if (segments.length === 0) {
    throw new Error('bash command is empty')
  }
  return segments.map(parseSingleCommand)
}

/**
 * 按 `&&` 分割，但跳过引号内的 `&&`。
 */
function splitByAndAnd(command: string): string[] {
  const result: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let i = 0
  while (i < command.length) {
    const char = command[i]
    // 引号切换
    if (char === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      i++
      continue
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      i++
      continue
    }
    // 在引号内，原样保留
    if (inSingleQuote || inDoubleQuote) {
      current += char
      i++
      continue
    }
    // 检查 && 分隔符
    if (char === '&' && command[i + 1] === '&') {
      const trimmed = current.trim()
      if (!trimmed)
        throw new Error('&& 前缺少命令')
      result.push(trimmed)
      current = ''
      i += 2
      continue
    }
    current += char
    i++
  }
  if (inSingleQuote || inDoubleQuote)
    throw new Error('引号未闭合')
  const trimmed = current.trim()
  if (!trimmed)
    throw new Error(result.length > 0 ? '&& 后缺少命令' : '命令为空')
  result.push(trimmed)
  return result
}

function splitByShellOperators(command: string): string[] {
  const result: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (char === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      continue
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      continue
    }
    if (inSingleQuote || inDoubleQuote) {
      current += char
      continue
    }
    const isCommandSubstitution = (char === '$' && command[index + 1] === '(') || char === '`'
    const isOperator = char === '|' || char === ';' || char === '\n' || isCommandSubstitution
      || char === '&'
    if (!isOperator) {
      current += char
      continue
    }
    const trimmed = current.trim()
    if (trimmed) {
      result.push(trimmed)
    }
    current = ''
    if ((char === '|' || char === '&') && command[index + 1] === char) {
      index++
    }
    else if (isCommandSubstitution && char === '$') {
      index++
    }
  }
  const trimmed = current.trim()
  if (trimmed) {
    result.push(trimmed)
  }
  return result
}

function parseSingleCommand(command: string): { command: string, args: string[] } {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(token => token.replace(/^['"]|['"]$/g, '')) ?? []
  if (tokens.length === 0) {
    throw new Error('bash command is blocked')
  }
  return { command: tokens[0], args: tokens.slice(1) }
}

function parseSegments(
  rawSegments: Array<{ command: string, args: string[] }>,
  initialCwd: string,
  policy: PathPolicy,
  blockAgentBrowser?: boolean,
): ParsedBashSegment[] {
  const segments: ParsedBashSegment[] = []
  let currentCwd = initialCwd
  for (const rawSegment of rawSegments) {
    const { segment, nextCwd } = parseSegment(rawSegment, currentCwd, policy, blockAgentBrowser)
    segments.push(segment)
    currentCwd = nextCwd
  }
  return segments
}

function parseSegment(
  seg: { command: string, args: string[] },
  cwd: string,
  policy: PathPolicy,
  blockAgentBrowser?: boolean,
): { segment: ParsedBashSegment, nextCwd: string } {
  const command = seg.command
  const args = seg.args
  const inputBasename = path.basename(command).toLowerCase()
  const isCd = command === 'cd'

  if (isCd) {
    const target = args.length === 1 ? resolveShellPath(args[0], cwd) : undefined
    const canonicalTarget = target ? resolveRealPathIfPresent(target) : cwd
    const validTarget = Boolean(target && isDirectory(canonicalTarget))
    return {
      segment: {
        rawCommand: `${command} ${args.join(' ')}`.trim(),
        command,
        executableBasename: 'cd',
        args,
        cwd: canonicalTarget,
        isCd: true,
        isHardBlocked: !validTarget,
        blockReason: validTarget ? undefined : 'cd 只接受一个已存在的目录',
        isReadOnly: true,
        isInsideWorkspace: validTarget && policy.isInsideWorkspace(canonicalTarget),
        resourceScope: validTarget && policy.isInsideWorkspace(canonicalTarget) ? 'workspace' : 'outside',
      },
      nextCwd: validTarget ? canonicalTarget : cwd,
    }
  }

  // 黑白名单只按用户输入的 basename 识别，不做 PATH 遍历或 symlink 解析。
  // PATH 可信：若 mytool 指向 /bin/rm，视为用户环境自身的行为，不由权限层防御。
  // 详见 executableIdentity.ts 的安全模型说明。
  const hardBlock = checkHardBlock(inputBasename, args, blockAgentBrowser)

  let isInsideWorkspace = true
  let mkdirArgumentError: string | undefined
  if (inputBasename === 'mkdir') {
    const mkdirArguments = parseMkdirTargets(args)
    mkdirArgumentError = mkdirArguments.error
    isInsideWorkspace = Boolean(mkdirArguments.targets?.length)
      && validateMkdirTargets(mkdirArguments.targets ?? [], cwd, policy)
  }
  else {
    isInsideWorkspace = args.every(arg => !isPathOutsidePolicy(arg, cwd, policy))
  }

  const isReadOnly = checkReadOnly(inputBasename, args)
  const isHardBlocked = hardBlock.blocked || Boolean(mkdirArgumentError)
  const blockReason = hardBlock.reason ?? mkdirArgumentError
  const resourceScope = isInsideWorkspace && policy.isInsideWorkspace(cwd) ? 'workspace' : 'outside'

  return {
    segment: {
      rawCommand: `${command} ${args.join(' ')}`.trim(),
      command,
      executableBasename: inputBasename,
      args,
      cwd,
      isCd: false,
      isHardBlocked,
      blockReason,
      isReadOnly,
      isInsideWorkspace,
      resourceScope,
    },
    nextCwd: cwd,
  }
}

function checkHardBlock(
  inputBasename: string,
  args: string[],
  blockAgentBrowser?: boolean,
): { blocked: boolean, reason?: string } {
  if (FORBIDDEN_COMMANDS.has(inputBasename)) {
    return { blocked: true, reason: `禁止命令: ${inputBasename}` }
  }

  if (inputBasename in PACKAGE_INSTALL_COMMANDS && isPackageInstallCommand(inputBasename, args)) {
    return { blocked: true, reason: `禁止包安装: ${inputBasename}` }
  }

  if (blockAgentBrowser && isAgentBrowserCommand(inputBasename, args)) {
    return { blocked: true, reason: '禁止启动 agent-browser' }
  }

  return { blocked: false }
}

function isPackageInstallCommand(packageInstaller: string, args: string[]): boolean {
  if (packageInstaller === 'yarn' && args.length === 0) {
    return true
  }
  const installCommands = PACKAGE_INSTALL_COMMANDS[packageInstaller]
  return args.some(arg => installCommands?.has(arg))
}

/**
 * 只读命令判定。
 *
 * 带 secretEnv 的命令不进入自动 command_read（在 parseBashCommand 层处理）。
 * 参数安全的 git status/diff/log/show 归入只读，但拒绝 --output/--ext-diff/--textconv。
 */
function checkReadOnly(executableBasename: string, args: string[]): boolean {
  switch (executableBasename) {
    case 'pwd':
      return args.every(arg => arg === '-L' || arg === '-P')
    case 'ls':
    case 'cat':
      return true
    case 'rg':
      return !args.some(arg => arg === '--pre' || arg.startsWith('--pre=') || arg === '--pre-glob' || arg.startsWith('--pre-glob='))
    case 'find':
      return !args.some(arg => ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf'].includes(arg))
    case 'which':
      return args.length === 1 && /^[a-z][\w.+-]*$/i.test(args[0])
    case 'node':
      return args.length === 1 && (args[0] === '-v' || args[0] === '--version')
    case 'git': {
      const subcommand = args[0]
      if (!subcommand || !GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
        return false
      }
      // 拒绝会写文件或执行外部程序的参数
      return !args.some(arg =>
        GIT_FORBIDDEN_ARGS.some(forbidden => arg === forbidden || arg.startsWith(`${forbidden}=`)),
      )
    }
    default:
      return false
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory()
  }
  catch {
    return false
  }
}

function resolveRealPathIfPresent(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath)
  }
  catch {
    return filePath
  }
}

// ---- 路径辅助 ----

function looksLikePath(arg: string): boolean {
  return arg.startsWith('/')
    || arg.startsWith('~/')
    || arg === '~'
    || arg.startsWith('./')
    || arg.startsWith('../')
    || arg.includes('/')
    || arg.includes('\\')
}

function isPathOutsidePolicy(arg: string, cwd: string, policy: PathPolicy): boolean {
  const candidate = extractVisiblePath(arg)
  if (!candidate) {
    return false
  }
  const resolved = resolveShellPath(candidate, cwd)
  return !policy.isInsideWorkspace(resolved)
}

function extractVisiblePath(arg: string): string | undefined {
  const equalsIndex = arg.indexOf('=')
  if (arg.startsWith('-') && equalsIndex > 0) {
    const optionValue = arg.slice(equalsIndex + 1)
    return looksLikePath(optionValue) ? optionValue : undefined
  }
  return looksLikePath(arg) ? arg : undefined
}

function resolveShellPath(inputPath: string, cwd: string): string {
  if (inputPath === '~') {
    return process.env.HOME || cwd
  }
  if (inputPath.startsWith('~/')) {
    return path.resolve(process.env.HOME || cwd, inputPath.slice(2))
  }
  return path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(cwd, inputPath)
}

function validateMkdirTargets(targets: string[], cwd: string, policy: PathPolicy): boolean {
  return targets.every((target) => {
    const targetPath = path.resolve(cwd, target)
    if (!policy.isInsideWorkspace(targetPath)) {
      return false
    }
    let existingAncestor = targetPath
    while (!fs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor)
      if (parent === existingAncestor) {
        return false
      }
      existingAncestor = parent
    }
    const realAncestor = fs.realpathSync.native(existingAncestor)
    return policy.isInsideWorkspace(realAncestor)
  })
}

function parseMkdirTargets(args: string[]): { targets?: string[], error?: string } {
  const targets: string[] = []
  let optionsEnded = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (optionsEnded) {
      targets.push(arg)
      continue
    }
    if (arg === '--') {
      optionsEnded = true
      continue
    }
    if (arg === '-p' || arg === '--parents' || arg === '-v' || arg === '--verbose' || /^-[pv]+$/u.test(arg)) {
      continue
    }
    if (arg === '-m' || arg === '--mode') {
      if (index + 1 >= args.length) {
        return { error: `mkdir 选项 ${arg} 缺少参数` }
      }
      index++
      continue
    }
    if (arg.startsWith('--mode=') || /^-m.+/u.test(arg)) {
      continue
    }
    if (arg.startsWith('-')) {
      return { error: `mkdir 选项不受支持: ${arg}` }
    }
    targets.push(arg)
  }
  return targets.length > 0 ? { targets } : { error: 'mkdir 缺少目标目录' }
}

function hasUnsupportedShellSyntax(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }
    if (char === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }
    if (inSingleQuote)
      continue
    if (char === '\n' || char === '>' || char === '<' || char === '|' || char === ';' || char === '`' || char === '$')
      return true
    if (!inDoubleQuote && (char === '*' || char === '?' || char === '['))
      return true
    if (!inDoubleQuote && char === '&' && command[index + 1] !== '&' && command[index - 1] !== '&')
      return true
  }
  return false
}

function findInlineEnvironmentVariable(command: string): string | undefined {
  try {
    for (const segment of splitByAndAnd(command)) {
      const match = segment.match(/^([A-Z_]\w*)\+?=/iu)
      if (match)
        return match[1]
    }
  }
  catch {
    // 语法错误由 canonical parser 的统一失败路径报告。
  }
  return undefined
}

function findUnverifiableShellStructure(command: string): string | undefined {
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (char === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }
    if (inSingleQuote)
      continue
    if (char === '$' || char === '`')
      return '动态展开或命令替换'
    if (inDoubleQuote)
      continue
    if (char === '\\')
      return '反斜杠转义'
    if (char === '!')
      return '控制操作符'
    if (char === '(' || char === ')' || char === '{' || char === '}')
      return '分组、子 shell 或命令替换'
  }

  try {
    for (const segment of splitByShellOperators(command)) {
      const firstToken = segment.match(/^\S+/u)?.[0]
      if (firstToken?.includes('"') || firstToken?.includes('\''))
        return '命令名包含引号拼接'
      if (firstToken && /[*?[]/u.test(firstToken))
        return '命令名包含 glob 展开'
      const normalizedFirstToken = firstToken?.toLowerCase()
      if (normalizedFirstToken && SHELL_CONTROL_WORDS.has(normalizedFirstToken))
        return `控制关键字 ${normalizedFirstToken}`
    }
  }
  catch {
    return '无法解析'
  }
  return undefined
}

function isAgentBrowserCommand(inputBasename: string, args: string[]): boolean {
  if (inputBasename === 'agent-browser') {
    return true
  }
  return inputBasename === 'npx' && args.includes('agent-browser')
}

// ---- 规则匹配 ----

/**
 * 检查已解析的 Bash 命令是否匹配某条持久规则。
 *
 * Bash 多段命令中，每段独立匹配；所有需要审批的段都必须命中才能跳过审批。
 * `cd` 段不参与匹配。
 */
export function matchBashRule(parsed: ParsedBashCommand, rule: CommandRule): boolean {
  if (rule.interpreter !== 'bash') {
    return false
  }
  for (const segment of parsed.segments) {
    if (segment.isCd) {
      continue
    }
    if (segment.isHardBlocked) {
      continue // 被硬阻断的段不需要规则匹配
    }
    // 资源边界必须匹配
    if (rule.resourceScope !== segment.resourceScope) {
      continue
    }
    // 命令身份按用户输入的字符串精确匹配，不做路径解析
    if (rule.executable !== segment.command) {
      continue
    }
    // argvPrefix 必须是段参数的前缀
    if (!isArgvPrefix(rule.argvPrefix, segment.args)) {
      continue
    }
    // 如果规则不允许后续参数，参数必须完全匹配
    if (!rule.allowRemainingArgs && rule.argvPrefix.length !== segment.args.length) {
      continue
    }
    // 所有检查通过，该段命中
    return true
  }
  return false
}

/**
 * 检查 Bash 命令的所有非 cd、非硬阻断段是否都被规则覆盖。
 * 返回未命中的段索引列表。
 */
export function findUnmatchedBashSegments(parsed: ParsedBashCommand, rules: CommandRule[]): number[] {
  const unmatched: number[] = []
  for (let i = 0; i < parsed.segments.length; i++) {
    const segment = parsed.segments[i]
    if (segment.isCd || segment.isHardBlocked) {
      continue
    }
    const matched = rules.some(rule => matchSegmentAgainstRule(segment, rule))
    if (!matched) {
      unmatched.push(i)
    }
  }
  return unmatched
}

function matchSegmentAgainstRule(segment: ParsedBashSegment, rule: CommandRule): boolean {
  if (rule.interpreter !== 'bash') {
    return false
  }
  if (rule.resourceScope !== segment.resourceScope) {
    return false
  }
  if (rule.executable !== segment.command) {
    return false
  }
  if (!isArgvPrefix(rule.argvPrefix, segment.args)) {
    return false
  }
  if (!rule.allowRemainingArgs && rule.argvPrefix.length !== segment.args.length) {
    return false
  }
  return true
}

function isArgvPrefix(prefix: string[], args: string[]): boolean {
  if (prefix.length > args.length) {
    return false
  }
  return prefix.every((arg, i) => arg === args[i])
}

// ---- 规则候选生成 ----

/**
 * 为已解析的 Bash 命令生成审批候选。
 *
 * 每个非 cd、非硬阻断段生成一个候选。
 * 带 secretEnv 的命令不生成候选。
 */
export function createBashCandidates(parsed: ParsedBashCommand, segmentIndexes?: number[]): CommandSegmentCandidate[] {
  if (parsed.hasSecretEnv) {
    return []
  }
  const candidates: CommandSegmentCandidate[] = []
  const selected = segmentIndexes ? new Set(segmentIndexes) : undefined
  for (let i = 0; i < parsed.segments.length; i++) {
    const segment = parsed.segments[i]
    if (selected && !selected.has(i)) {
      continue
    }
    if (segment.isCd || segment.isHardBlocked) {
      continue
    }
    candidates.push({
      type: 'command-segment',
      interpreter: 'bash',
      segmentIndex: i,
      executable: segment.command,
      displayCommand: segment.rawCommand,
      argvPrefix: [...segment.args],
      canWholeExecutable: true,
      resourceScope: segment.resourceScope,
    })
  }
  return candidates
}
