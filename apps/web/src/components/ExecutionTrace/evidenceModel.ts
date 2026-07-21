import type {
  AgentObservabilityEvidence,
  AgentObservabilityRecord,
  AgentTurnTimelineItem,
  PolicyBasis,
  TraceSpanStatus,
} from '@ant-chat/shared'

/**
 * 执行轨迹证据视图模型。
 *
 * Trace schema 中 input/output/error 均为 unknown（由后端各 owner 自由上报），
 * 这里做防御性解析：字段缺失或类型不符时降级为 undefined，绝不抛错；
 * 整体结构无法识别时回退为 FallbackView，由 UI 引导用户查看原始证据。
 */

export interface MessageBlockView {
  type: 'text' | 'image' | 'file' | 'tool-call' | 'tool-result' | 'unknown'
  text?: string
  mimeType?: string
  toolName?: string
  toolCallId?: string
  args?: Record<string, unknown>
  result?: unknown
  isError?: boolean
  /** 未识别内容块的原始值，开发者视图用 JsonTree 兜底展示 */
  raw?: unknown
}

export interface MessageView {
  role: string
  blocks: MessageBlockView[]
}

export interface ToolDefinitionView {
  name: string
  serverName?: string
  description?: string
  inputSchema?: unknown
}

export interface UsageView {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

export interface ModelToolCallView {
  id?: string
  toolName: string
  input?: unknown
  invalidArgsError?: string
}

interface SpanTiming {
  status?: TraceSpanStatus
  startedAt?: number
  endedAt?: number
  /** 完成后的 Trace 缺少 span-completed 记录时为 true。 */
  pending: boolean
}

export interface ModelRequestView extends SpanTiming {
  type: 'model-request'
  model?: string
  temperature?: number
  maxOutputTokens?: number
  reasoningEffort?: string
  systemPrompt?: string
  messages: MessageView[]
  tools: ToolDefinitionView[]
  responseText?: string
  finishReason?: string
  usage?: UsageView
  toolCalls: ModelToolCallView[]
  responseDurationMs?: number
  errorText?: string
  /** 原始错误对象（含 stack），开发者视图展示 */
  errorRaw?: unknown
}

export interface ToolCallEvidenceView extends SpanTiming {
  type: 'tool-call'
  toolName?: string
  serverName?: string
  operationType?: string
  scope?: string
  workspacePath?: string
  step?: number
  toolCallId?: string
  input?: Record<string, unknown>
  outputText?: string
  errorText?: string
  diagnostics?: unknown
  exitCode?: number
  durationMs?: number
  /** 失败时整个 envelope 进入 error 字段，开发者视图展示原始结构 */
  errorRaw?: unknown
}

export interface PolicyDecisionView extends SpanTiming {
  type: 'policy-decision'
  toolName?: string
  operationType?: string
  scope?: string
  policy?: string
  /** 判定依据 key（backend decidePolicy/decideAutomationPolicy 发出），policyBasisLabel 转中文 */
  basis?: string
  /** 应用记忆授权或人工审批前的基础判定依据。 */
  initialBasis?: string
  /** 交互 Turn 的权限模式（strict/hybrid/full_managed） */
  mode?: string
  /** Automation Turn 的权限策略 */
  automationPolicy?: Record<string, unknown>
  workspacePath?: string
  step?: number
  toolCallId?: string
  input?: Record<string, unknown>
  outcome?: string
  reason?: string
  errorCode?: string
  whitelistMatchKey?: string
  whitelistEntry?: unknown
  /** 审批结果（status 为 approval 时存在） */
  approvalApproved?: boolean
  approvalReason?: string
  errorRaw?: unknown
}

export interface ContextEventView {
  type: 'context-event'
  eventKind?: string
  recordedAt?: number
  /** steering：追加的指令文本 */
  text?: string
  messageId?: string
  /** compaction：触发方式与压缩结果 */
  trigger?: string
  compactedThroughMessageId?: string
  summaryText?: string
  inputMessageCount?: number
  outputMessageCount?: number
  /** 完整事件证据，开发者视图展示 */
  raw?: unknown
}

export interface FallbackView {
  type: 'fallback'
  status?: TraceSpanStatus
  startedAt?: number
  endedAt?: number
  reason: string
}

export type EvidenceView
  = | ModelRequestView
    | ToolCallEvidenceView
    | PolicyDecisionView
    | ContextEventView
    | FallbackView

/** 解析证据记录为视图模型。item 提供 kind 与时间线状态兜底。 */
export function parseEvidence(item: AgentTurnTimelineItem, evidence: AgentObservabilityEvidence | null): EvidenceView {
  if (!evidence) {
    return fallbackView(item, '原始证据不可用')
  }
  if (item.type === 'context-event') {
    return parseContextEvent(item, evidence.records)
  }
  const started = evidence.records.find(record => record.recordType === 'span-started')
  const completed = evidence.records.find(record => record.recordType === 'span-completed')
  if (!started || started.recordType !== 'span-started')
    return fallbackView(item, '缺少 span-started 记录')

  const timing: SpanTiming = {
    status: (completed && completed.recordType === 'span-completed' ? completed.status : undefined) ?? item.status,
    startedAt: started.startedAt,
    endedAt: completed && completed.recordType === 'span-completed' ? completed.endedAt : undefined,
    pending: !completed,
  }
  const output = completed && completed.recordType === 'span-completed' ? completed.output : undefined
  const error = completed && completed.recordType === 'span-completed' ? completed.error : undefined

  if (started.spanKind === 'model-request')
    return parseModelRequest(timing, started.input, output, error)
  if (started.spanKind === 'tool-call')
    return parseToolCall(timing, started.input, output, error)
  if (started.spanKind === 'policy-decision')
    return parsePolicyDecision(timing, started.input, output, error)
  return fallbackView(item, `未知 span 类型：${String(started.spanKind)}`)
}

export const itemLabels: Record<string, string> = {
  'model-request': '模型请求',
  'policy-decision': '策略判断',
  'tool-call': '工具调用',
  'compaction': '上下文压缩',
  'steering': '追加指令',
  'history-rewrite': '历史重写',
}

const agentModeLabels: Record<string, string> = {
  strict: '默认权限',
  hybrid: '自动审查',
  full_managed: '完全访问权限',
}

export function agentModeLabel(mode: string | undefined): string | undefined {
  return mode ? (agentModeLabels[mode] ?? mode) : undefined
}

const policyBasisLabels: Record<PolicyBasis, string> = {
  'mode.full-managed': '完全访问权限模式：允许全部操作',
  'scope.blocked': '策略禁止该操作',
  'scope.outside': '工作区外操作需要人工审批',
  'scope.external': '外部服务操作需要人工审批',
  'workspace.read': '工作区内只读操作默认允许',
  'hybrid.write': '自动审查模式：允许工作区内写入',
  'default.require-approval': '当前权限模式要求人工审批',
  'approval-grant.match': '已命中用户记住的授权规则',
  'approval.user-approved': '用户已批准本次操作',
  'approval.user-rejected': '用户已拒绝本次操作',
  'automation.no-policy': '自动化任务未配置权限策略，安全默认拒绝',
  'automation.scope.blocked': '自动化任务不允许访问工作区外资源',
  'automation.read.allow': '自动化策略允许读取',
  'automation.browser.allow': '自动化策略允许浏览器操作',
  'automation.browser.blocked': '自动化任务未授权浏览器操作',
  'automation.browser-profile.blocked': '自动化任务不允许复用系统浏览器身份',
  'automation.write.allow': '自动化策略授予工作区写权限',
  'automation.write.blocked': '自动化任务仅有工作区读取权限',
  'automation.skill.allow': '自动化策略允许 Skill 调用',
  'automation.bash-read.allow': '自动化策略授权命令执行',
  'automation.bash-read.blocked': '自动化任务未授权命令执行',
  'automation.mcp.allow': '自动化策略允许调用所选 MCP 工具',
  'automation.mcp.blocked': '自动化任务未授权 MCP 工具',
  'automation.bash.allow': '自动化策略允许全部命令',
  'automation.bash.blocked': '自动化任务未授权命令执行',
  'automation.bash.pattern-match': '命令命中自动化允许范围',
  'automation.bash.pattern-blocked': '命令不在自动化任务允许范围内',
  'automation.unsupported': '自动化任务不支持该操作类型',
}

export function policyBasisLabel(basis: string | undefined): string | undefined {
  return basis ? (policyBasisLabels[basis] ?? basis) : undefined
}

export function spanStatusLabel(status: TraceSpanStatus | undefined, pending: boolean): string {
  if (pending)
    return '未结束'
  switch (status) {
    case 'success': return '成功'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    case 'allow': return '允许'
    case 'block': return '已阻止'
    case 'blocked': return '已阻止'
    case 'approval': return '需审批'
    default: return '未知'
  }
}

export function spanStatusTone(status: TraceSpanStatus | undefined, pending: boolean): 'success' | 'danger' | 'warning' | 'muted' {
  if (pending)
    return 'warning'
  switch (status) {
    case 'success':
    case 'allow':
      return 'success'
    case 'failed':
    case 'block':
    case 'blocked':
      return 'danger'
    case 'approval':
    case 'cancelled':
      return 'warning'
    default:
      return 'muted'
  }
}

// ============================================================
// 各类型解析
// ============================================================

function parseModelRequest(timing: SpanTiming, input: unknown, output: unknown, error: unknown): ModelRequestView {
  const request = asRecord(input)
  const settings = asRecord(request?.modelSettings)
  const response = asRecord(output)
  const messages = asArray(request?.messages) ?? []
  const tools = asArray(request?.tools) ?? []
  return {
    type: 'model-request',
    ...timing,
    model: asString(settings?.model),
    temperature: asNumber(settings?.temperature),
    maxOutputTokens: asNumber(settings?.maxOutputTokens),
    reasoningEffort: asString(settings?.reasoningEffort),
    systemPrompt: asString(settings?.systemPrompt),
    messages: messages.map(parseMessage).filter((message): message is MessageView => message !== undefined),
    tools: tools.map(parseToolDefinition).filter((tool): tool is ToolDefinitionView => tool !== undefined),
    responseText: asString(response?.text),
    finishReason: asString(response?.finishReason),
    usage: parseUsage(response?.usage),
    toolCalls: (asArray(response?.toolCalls) ?? []).map(parseModelToolCall).filter((call): call is ModelToolCallView => call !== undefined),
    responseDurationMs: asNumber(response?.durationMs),
    errorText: errorToText(error),
    errorRaw: error,
  }
}

function parseToolCall(timing: SpanTiming, input: unknown, output: unknown, error: unknown): ToolCallEvidenceView {
  const request = asRecord(input)
  // 成功时结果在 output envelope；失败时整个 envelope 进入 error 字段（见 toolExecution.ts）
  const envelope = asRecord(output) ?? asRecord(error)
  const errorText = errorToText(error) ?? asString(envelope?.error)
  const rawOutputText = asString(envelope?.output)
  // 失败工具的结果文本常与失败原因完全相同（如 ENOENT），去重避免 UI 重复渲染
  const outputText = errorText && rawOutputText?.trim() === errorText.trim() ? undefined : rawOutputText
  return {
    type: 'tool-call',
    ...timing,
    toolName: asString(request?.toolName),
    serverName: asString(request?.serverName),
    operationType: asString(request?.operationType),
    scope: asString(request?.scope),
    workspacePath: asString(request?.workspacePath),
    step: asNumber(request?.step),
    toolCallId: asString(request?.toolCallId),
    input: asRecord(request?.input),
    outputText,
    errorText,
    diagnostics: envelope?.diagnostics,
    exitCode: asNumber(envelope?.exitCode),
    durationMs: asNumber(envelope?.durationMs),
    errorRaw: error,
  }
}

function parsePolicyDecision(timing: SpanTiming, input: unknown, output: unknown, error: unknown): PolicyDecisionView {
  const request = asRecord(input)
  const decision = asRecord(output)
  const whitelist = asRecord(decision?.whitelist)
  const approval = asRecord(decision?.approval)
  const initialDecision = asRecord(request?.initialDecision)
  const effectiveDecision = asRecord(decision?.effectiveDecision)
  const initialBasis = asString(initialDecision?.basis) ?? asString(request?.basis)
  return {
    type: 'policy-decision',
    ...timing,
    toolName: asString(request?.toolName),
    operationType: asString(request?.operationType),
    scope: asString(request?.scope),
    policy: asString(request?.policy),
    basis: asString(effectiveDecision?.basis) ?? initialBasis,
    initialBasis,
    mode: asString(request?.mode),
    automationPolicy: asRecord(request?.automationPolicy),
    workspacePath: asString(request?.workspacePath),
    step: asNumber(request?.step),
    toolCallId: asString(request?.toolCallId),
    input: asRecord(request?.input),
    outcome: asString(decision?.outcome),
    reason: asString(decision?.reason) ?? errorToText(error),
    errorCode: asString(decision?.errorCode),
    whitelistMatchKey: asString(whitelist?.matchKey),
    whitelistEntry: whitelist?.entry,
    approvalApproved: typeof approval?.approved === 'boolean' ? approval.approved : undefined,
    approvalReason: asString(approval?.reason),
    errorRaw: error,
  }
}

function parseContextEvent(item: Extract<AgentTurnTimelineItem, { type: 'context-event' }>, records: AgentObservabilityRecord[]): ContextEventView {
  const record = records.find(entry => entry.recordType === 'context-event')
  const evidence = record && record.recordType === 'context-event' ? asRecord(record.evidence) : undefined
  const eventInput = asRecord(evidence?.input)
  const eventOutput = asRecord(evidence?.output)
  return {
    type: 'context-event',
    eventKind: asString(evidence?.kind) ?? item.kind,
    recordedAt: item.recordedAt,
    text: asString(evidence?.text),
    messageId: asString(evidence?.messageId),
    trigger: asString(evidence?.trigger),
    compactedThroughMessageId: asString(evidence?.compactedThroughMessageId),
    summaryText: asString(eventOutput?.summaryText),
    inputMessageCount: asArray(eventInput?.contextEntries)?.length,
    outputMessageCount: asArray(eventOutput?.messages)?.length,
    raw: record && record.recordType === 'context-event' ? record.evidence : undefined,
  }
}

// ============================================================
// 防御性辅助
// ============================================================

function fallbackView(item: AgentTurnTimelineItem, reason: string): FallbackView {
  return {
    type: 'fallback',
    status: item.type === 'span' ? item.status : undefined,
    startedAt: item.type === 'span' ? item.startedAt : item.recordedAt,
    endedAt: item.type === 'span' ? item.endedAt : undefined,
    reason,
  }
}

function parseMessage(value: unknown): MessageView | undefined {
  const record = asRecord(value)
  const role = asString(record?.role)
  if (!record || !role)
    return undefined
  // content 标准形态是数组，容忍字符串（历史或简化数据）
  if (typeof record.content === 'string')
    return { role, blocks: [{ type: 'text', text: record.content }] }
  const content = asArray(record.content)
  if (!content)
    return undefined
  return { role, blocks: content.map(parseMessageBlock) }
}

function parseMessageBlock(value: unknown): MessageBlockView {
  const record = asRecord(value)
  if (!record)
    return { type: 'unknown', raw: value }
  switch (record.type) {
    case 'text':
      return { type: 'text', text: asString(record.text) ?? '' }
    case 'image':
      return { type: 'image', mimeType: asString(record.mimeType) }
    case 'file':
      return { type: 'file', mimeType: asString(record.mimeType) }
    case 'tool-call':
      return {
        type: 'tool-call',
        toolName: asString(record.toolName),
        toolCallId: asString(record.toolCallId),
        args: asRecord(record.args),
      }
    case 'tool-result':
      return {
        type: 'tool-result',
        toolName: asString(record.toolName),
        toolCallId: asString(record.toolCallId),
        result: record.result,
        isError: record.isError === true,
      }
    default:
      return { type: 'unknown', raw: value }
  }
}

function parseToolDefinition(value: unknown): ToolDefinitionView | undefined {
  const record = asRecord(value)
  const name = asString(record?.name)
  if (!record || !name)
    return undefined
  return {
    name,
    serverName: asString(record.serverName),
    description: asString(record.description),
    inputSchema: record.inputSchema,
  }
}

function parseModelToolCall(value: unknown): ModelToolCallView | undefined {
  const record = asRecord(value)
  const toolName = asString(record?.toolName)
  if (!record || !toolName)
    return undefined
  return {
    id: asString(record.id),
    toolName,
    input: record.input,
    invalidArgsError: asString(record.invalidArgsError),
  }
}

function parseUsage(value: unknown): UsageView | undefined {
  const record = asRecord(value)
  if (!record)
    return undefined
  return {
    inputTokens: asNumber(record.inputTokens),
    outputTokens: asNumber(record.outputTokens),
    totalTokens: asNumber(record.totalTokens),
    reasoningTokens: asNumber(record.reasoningTokens),
    cachedInputTokens: asNumber(record.cachedInputTokens),
  }
}

function errorToText(error: unknown): string | undefined {
  if (error == null)
    return undefined
  if (typeof error === 'string')
    return error
  const record = asRecord(error)
  if (!record)
    return String(error)
  // 工具失败 envelope：内层 error 字段是真正的失败原因
  if (typeof record.error === 'string')
    return record.error
  // 脱敏后的 Error 对象：{ name, message, stack? }
  if (typeof record.message === 'string' && record.message)
    return record.message
  // AI_APICallError 等 provider 错误的 message 不可枚举，脱敏后丢失：用 name + statusCode 摘要
  const name = asString(record.name)
  const statusCode = asNumber(record.statusCode)
  if (name && statusCode != null)
    return `${name}（HTTP ${statusCode}）`
  if (name)
    return name
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}
