import type { AgentToolResult, CommandToolInput, SecretRef, SecretStore } from '@ant-chat/shared'
import type { BackgroundCommandManager } from './backgroundCommandManager'
import type { AvailableCommandHost, PreparedCommandState } from './types'
import { createNativeTool } from '../tools/toolFactory'
import { prepareBashCommand } from './bashCommandAdapter'
import { runPreparedCommand } from './commandRunner'
import { redactSecrets } from './redactSecrets'
import { prepareWindowsCommand } from './windowsCommandAdapter'

export interface CreateCommandToolOptions {
  blockAgentBrowser?: boolean
  runId?: string
  secretStore?: SecretStore
  trustedPaths?: string[]
  /** 会话级后台命令管理器；缺省时 runInBackground 不可用。 */
  backgroundCommands?: BackgroundCommandManager
  /** 当前会话 id；后台命令按会话隔离。 */
  conversationId?: string
}

const COMMAND_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    command: { type: 'string' },
    description: { type: 'string', description: '一句话说明这条命令的目的，例如「构建项目」' },
    cwd: { type: 'string' },
    timeoutMs: { type: 'number' },
    secretEnv: {
      type: 'object',
      description: '环境变量名到当前 Turn SecretRef 的映射；不接受普通字符串、persistent SecretRef 或 PATH。',
      additionalProperties: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['secret_ref'] },
          id: { type: 'string' },
          scope: { type: 'string', enum: ['turn'] },
        },
        required: ['kind', 'id', 'scope'],
      },
    },
    runInBackground: {
      type: 'boolean',
      description: 'true 时命令在后台运行并立即返回 commandId（用于 dev server、watch、长构建/测试）；用 read_command_output 读取增量输出，用 kill_command 终止。后台模式忽略默认 10s 超时。',
    },
  },
  required: ['command'],
}

export function createCommandTool(
  workspacePath: string,
  unrestricted: boolean,
  host: AvailableCommandHost,
  options: CreateCommandToolOptions = {},
) {
  const prepareCommand = (input: Record<string, unknown>): PreparedCommandState =>
    host.adapter === 'bash'
      ? prepareBashCommand(input as unknown as CommandToolInput, workspacePath, host, {
          trustedPaths: options.trustedPaths,
          blockAgentBrowser: options.blockAgentBrowser,
        })
      : prepareWindowsCommand(input as unknown as CommandToolInput, workspacePath, host, {
          trustedPaths: options.trustedPaths,
          blockAgentBrowser: options.blockAgentBrowser,
        })

  return createNativeTool({
    name: 'execute_command',
    description: createCommandDescription(host.interpreter),
    inputSchema: COMMAND_INPUT_SCHEMA,
    operationType: 'command',
    unrestricted,
    validateInput: validateCommandInput,
    inferScope(input) {
      const prepared = prepareCommand(input)
      return prepared.risk === 'bottomline_block' ? 'blocked' : prepared.resourceScope
    },
    async execute(input) {
      const prepared = prepareCommand(input)
      return executeCommand(prepared, unrestricted, options)
    },
    prepare(input) {
      const prepared = prepareCommand(input)
      return {
        scope: prepared.risk === 'bottomline_block' ? 'blocked' : prepared.resourceScope,
        operationType: prepared.isReadOnly ? 'command_read' : 'command',
        state: prepared,
        execute: (_input, abortSignal) => executeCommand(prepared, unrestricted, options, abortSignal),
        executeRelaxed: (_input, abortSignal) => executeCommand(prepared, true, options, abortSignal),
      }
    },
  })
}

function createCommandDescription(interpreter: AvailableCommandHost['interpreter']): string {
  const common = [
    '使用启动时固定的解释器执行命令。默认工作目录是当前工作区；只有进入子目录时才传 cwd 或使用解释器支持的目录切换语法。',
    'input 固定为 command、description、cwd、timeoutMs、secretEnv。secretEnv 只接受当前 Turn SecretRef，且不能覆盖 PATH。',
    '删除、网络、安装、提权、环境修改等高风险操作在严格/自动审查模式下需要单次审批；危及系统、用户目录或工作区根的命令始终阻断。',
  ]
  if (interpreter === 'bash') {
    return [
      '当前解释器：Bash。',
      '可使用 Bash 引号和 &&；管道、重定向、分号等复杂语法不能生成持久权限规则。',
      '环境变量使用 $NAME。不要嵌套启动 shell、使用 eval、命令替换或动态命令名。',
      ...common,
    ].join('\n')
  }
  if (interpreter === 'powershell7') {
    return [
      '当前解释器：PowerShell 7（pwsh.exe）。',
      '使用 PowerShell 语法；串联命令使用 ;，环境变量使用 $env:NAME，字符串优先使用单引号。',
      '不要嵌套 -Command、调用脚本文件或使用动态命令名。',
      ...common,
    ].join('\n')
  }
  if (interpreter === 'windows-powershell') {
    return [
      '当前解释器：Windows PowerShell（powershell.exe）。',
      '使用 Windows PowerShell 语法；串联命令使用 ;，环境变量使用 $env:NAME，字符串优先使用单引号。',
      '不要使用仅 PowerShell 7 支持的语法，不要嵌套 -Command、调用脚本文件或使用动态命令名。',
      ...common,
    ].join('\n')
  }
  return [
    '当前解释器：CMD（cmd.exe）。',
    '使用 CMD 语法；串联命令使用 &&，环境变量使用 %NAME%，引用包含空格的路径时使用双引号。',
    '不要发送 PowerShell cmdlet，不要使用 call、脚本文件、动态变量或嵌套解释器。',
    ...common,
  ].join('\n')
}

function validateCommandInput(input: Record<string, unknown>): string | null {
  if (typeof input.command !== 'string' || !input.command.trim())
    return 'command 必须是非空字符串'
  if (input.env !== undefined)
    return 'execute_command 不支持通用 env，请使用只接受当前 Turn SecretRef 的 secretEnv'
  if (input.description !== undefined && typeof input.description !== 'string')
    return 'description 必须是字符串'
  if (input.cwd !== undefined && typeof input.cwd !== 'string')
    return 'cwd 必须是字符串'
  if (input.timeoutMs !== undefined && (typeof input.timeoutMs !== 'number' || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0))
    return 'timeoutMs 必须是正数'
  if (input.runInBackground !== undefined && typeof input.runInBackground !== 'boolean')
    return 'runInBackground 必须是布尔值'
  if (input.secretEnv === undefined)
    return null
  if (!isPlainRecord(input.secretEnv))
    return 'secretEnv 必须是环境变量名到 SecretRef 的对象'

  for (const [key, value] of Object.entries(input.secretEnv)) {
    if (!/^[A-Z_]\w*$/i.test(key))
      return `secretEnv 包含非法环境变量名：${key}`
    if (key.toUpperCase() === 'PATH')
      return 'secretEnv 不允许覆盖 PATH'
    if (!isTurnSecretRef(value))
      return `secretEnv.${key} 必须是当前 Turn 的 SecretRef`
  }
  return null
}

async function executeCommand(
  prepared: PreparedCommandState,
  unrestricted: boolean,
  options: CreateCommandToolOptions,
  abortSignal?: AbortSignal,
): Promise<AgentToolResult> {
  const secretEnv: Record<string, string> = {}
  for (const [key, ref] of Object.entries(prepared.input.secretEnv || {})) {
    const value = options.runId && options.secretStore?.resolveTurnSecret
      ? await options.secretStore.resolveTurnSecret(ref, options.runId)
      : null
    if (!value)
      return { ok: false, result: `SecretRef 已失效或不存在：${ref.id}` }
    secretEnv[key] = value
  }
  if (prepared.input.runInBackground === true) {
    return executeBackgroundCommand(prepared, unrestricted, options, secretEnv)
  }
  const result = await runPreparedCommand(prepared, unrestricted, { secretEnv, abortSignal })
  return redactSecrets(result, Object.values(secretEnv))
}

async function executeBackgroundCommand(
  prepared: PreparedCommandState,
  unrestricted: boolean,
  options: CreateCommandToolOptions,
  secretEnv: Record<string, string>,
): Promise<AgentToolResult> {
  if (prepared.risk === 'bottomline_block')
    return { ok: false, result: `工具 execute_command 执行失败：${prepared.riskReason || '命令命中不可覆盖的底线保护'}` }
  if (!unrestricted && prepared.resourceScope === 'outside')
    return { ok: false, result: '命令涉及工作区外资源' }
  const manager = options.backgroundCommands
  const conversationId = options.conversationId
  if (!manager || !conversationId)
    return { ok: false, result: '后台命令不可用：当前运行环境未启用会话级后台命令管理器' }

  const started = manager.start(conversationId, prepared, {
    secretEnv,
    watchdogMs: prepared.input.timeoutMs,
  })
  if (!started.ok)
    return { ok: false, result: `后台命令启动失败：${started.reason}` }
  const summary = started.summary

  let output = ''
  try {
    const read = await manager.read(conversationId, summary.commandId, { tail: 4096 })
    output = redactSecrets(read.text, Object.values(secretEnv))
  }
  catch {
    // 首段输出读取失败不影响启动结果
  }

  const lines = [
    `后台命令已启动：${summary.commandId}`,
    `pid=${summary.pid ?? 'unknown'} status=running`,
    summary.hasSecretEnv ? `审计：该后台进程持有 Turn 密钥（${summary.secretEnvKeys.join(', ')}）` : '',
    `日志：${summary.logPath}`,
    '使用 read_command_output 读取增量输出，使用 kill_command 终止。',
  ].filter(Boolean)
  if (output)
    lines.push('', '--- 首段输出 ---', output)

  return {
    ok: true,
    result: lines.join('\n'),
    diagnostics: {
      commandId: summary.commandId,
      pid: summary.pid,
      status: 'running',
      logPath: summary.logPath,
    },
  }
}

function isTurnSecretRef(value: unknown): value is SecretRef {
  return isPlainRecord(value)
    && value.kind === 'secret_ref'
    && typeof value.id === 'string'
    && Boolean(value.id)
    && value.scope === 'turn'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
