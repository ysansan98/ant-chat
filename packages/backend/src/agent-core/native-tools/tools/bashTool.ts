import type { AgentToolResult, BashToolInput, SecretRef, SecretStore } from '@ant-chat/shared'
import { parseBashCommand } from './bashCommandParser'
import { runPreparedBashTool } from './bashRunner'
import { createNativeTool } from './toolFactory'

export function createBashTool(
  workspacePath: string,
  unrestricted: boolean,
  options: { bashEnvironment?: Record<string, string>, blockAgentBrowser?: boolean, runId?: string, secretStore?: SecretStore, trustedPaths?: string[] } = {},
) {
  const parse = (input: Record<string, unknown>) => parseBashCommand(
    input as unknown as BashToolInput,
    workspacePath,
    {
      executableSearchPath: options.bashEnvironment?.PATH,
      trustedPaths: options.trustedPaths,
      blockAgentBrowser: options.blockAgentBrowser,
    },
  )

  return createNativeTool({
    name: 'bash',
    description: [
      '执行 shell 命令。命令默认在工作区目录下执行，直接写命令即可，不要加 cd。',
      '',
      '语法限制：',
      '- 允许单个命令或使用 && 串联的多个命令。',
      '- 不要用 cd 切换到工作区目录，命令行已在正确目录下。如需在同一次调用中进入子目录再执行，才用 cd（如 cd subdir && ls）。每次调用都是独立 shell，cd 不会跨调用保留。',
      '- 引号内的 && 不是分隔符。',
      '- 管道(|)、重定向(> <)、分号(;)和多行命令会始终请求单次审批，不能保存为持久允许规则。',
      '- 子 shell、命令替换、分组、控制结构和未引用反斜杠无法可靠验证，会直接阻断。',
      '- rm、sudo、curl、wget、ssh、scp、shell 包装器、环境修改命令、内联环境变量赋值和包安装被禁止。',
      '- 完整原始命令只启动一次 shell；&& 分段仅用于权限分析。',
      '',
      '输出处理：',
      '- 管道等复杂 shell 语法会按原样展示给用户审批；不要假定已有持久命令授权会覆盖它。',
      '- 只允许通过 secretEnv 注入 requestSecret 返回的当前 Turn SecretRef；每次都需单次审批，不能覆盖 PATH。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        description: { type: 'string', description: '一句话说明这条命令的目的，例如「安装项目依赖」' },
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
      },
      required: ['command'],
    },
    unrestricted,
    validateInput: validateBashInput,
    inferScope: (input) => {
      const parsed = parse(input)
      return parsed.isBlocked ? 'blocked' : parsed.resourceScope
    },
    execute: input => executeBash(
      parse(input),
      unrestricted,
      input as unknown as BashToolInput,
      options.secretStore,
      options.runId,
    ),
    prepare: (input) => {
      const parsed = parse(input)
      return {
        scope: parsed.isBlocked ? 'blocked' : parsed.resourceScope,
        operationType: parsed.isReadOnly ? 'bash_read' : 'bash',
        state: { kind: 'bash', parsed },
        execute: input => executeBash(parsed, unrestricted, input as unknown as BashToolInput, options.secretStore, options.runId),
        executeRelaxed: input => executeBash(parsed, true, input as unknown as BashToolInput, options.secretStore, options.runId),
      }
    },
  })
}

function validateBashInput(input: Record<string, unknown>): string | null {
  if (typeof input.command !== 'string' || !input.command.trim())
    return 'command 必须是非空字符串'
  if (input.env !== undefined)
    return 'bash 不支持通用 env，请使用只接受当前 Turn SecretRef 的 secretEnv'
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

async function executeBash(
  parsed: ReturnType<typeof parseBashCommand>,
  unrestricted: boolean,
  input: BashToolInput,
  secretStore?: SecretStore,
  runId?: string,
): Promise<AgentToolResult> {
  const resolvedSecrets: Record<string, string> = {}
  for (const [key, ref] of Object.entries(input.secretEnv || {})) {
    const value = runId && secretStore?.resolveTurnSecret
      ? await secretStore.resolveTurnSecret(ref, runId)
      : null
    if (!value)
      return { ok: false, result: `SecretRef 已失效或不存在：${ref.id}` }
    resolvedSecrets[key] = value
  }

  const result = await runPreparedBashTool(parsed, unrestricted, {
    command: input.command,
    description: input.description,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    secretEnv: resolvedSecrets,
  })
  return redactSecrets(result, Object.values(resolvedSecrets))
}

function redactSecrets<T>(value: T, secrets: string[]): T {
  const replacements = secrets.filter(Boolean).sort((left, right) => right.length - left.length)
  const visit = (current: unknown): unknown => {
    if (typeof current === 'string')
      return replacements.reduce((text, secret) => text.split(secret).join('[secret]'), current)
    if (Array.isArray(current))
      return current.map(visit)
    if (isPlainRecord(current))
      return Object.fromEntries(Object.entries(current).map(([key, item]) => [key, visit(item)]))
    return current
  }
  return visit(value) as T
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
