// ================================================================
// Context Diagnostics — 共享类型定义
//
// 定义上下文追踪的 Schema、事件负载、Context Item 快照和 RPC 契约。
// 该模块仅在 contextDiagnosticsEnabled=true 的开发环境中使用。
// ================================================================

// ---- Context Item Types ----

/** Context Item 的快照身份标识（用于增量比较） */
export interface ContextItemIdentity {
  /** 类型相关稳定身份
   * - Message: message.id (持久化) 或 requestId + role + ordinal (运行中生成)
   * - System Prompt: 'system-prompt'
   * - Tool Definition: `source|serverName|toolName`
   * - Model Settings: 'model-settings'
   */
  id: string
}

/** Context Item 状态的判别联合 */
export type ContextItemStatus = 'full' | 'added' | 'updated' | 'removed'

/** 单条 Context Item 的快照 */
export interface ContextItemSnapshot {
  identity: ContextItemIdentity
  status: ContextItemStatus
  kind: 'system-prompt' | 'message' | 'tool-definition' | 'model-settings'
  /** 快照序号（从 0 开始）。只用于 delta/history-rewritten 后重排时的内部跟踪 */
  ordinal: number

  // —— 按 kind 区分的负载（至少有一个非空） ——
  content?: string
  source?: string
  serverName?: string
  toolName?: string
  role?: 'user' | 'assistant' | 'tool'
  toolCallId?: string
  /** 工具调用参数（model → tool-call） */
  toolArgs?: Record<string, unknown>
  /** 工具执行结果（tool-result） */
  toolResult?: string
  /** 工具执行是否失败 */
  isError?: boolean
  /** 同一条消息内多个工具调用/结果（完整列表，不含 text） */
  tools?: Array<{
    type: 'tool-call' | 'tool-result'
    toolName: string
    toolCallId: string
    args?: Record<string, unknown>
    result?: string
    isError?: boolean
  }>
  /** 字符数 / 调用数 */
  size?: number
  /** Model Settings 字段 */
  settings?: Record<string, unknown>
}

/** Delta 中的 Updated 项 */
export interface ContextItemUpdate {
  identity: ContextItemIdentity
  kind: ContextItemSnapshot['kind']
  field: string
  before: unknown
  after: unknown
}

/** 用于区分 Baseline 还是 Delta 存储 */
export interface BaselineStorage {
  kind: 'baseline'
  reason: 'initial' | 'compaction' | 'history-rewritten'
  items: ContextItemSnapshot[]
  addedItemIds?: string[]
  snapshotHash: string
}

export interface DeltaStorage {
  kind: 'delta'
  added: ContextItemSnapshot[]
  updated: ContextItemUpdate[]
  removed: ContextItemSnapshot[]
  previousSnapshotHash: string
  snapshotHash: string
}

// ---- Trace Events ----

export interface ModelRequestTracePayload {
  schemaVersion: 1
  requestId: string
  previousRequestId?: string
  conversationId: string
  userTurnId: string
  step: number
  model: string
  provider: string
  providerId: string
  apiMode: string
  storage: BaselineStorage | DeltaStorage
}

/** 模型请求完成事件（响应信息，仅最终请求） */
export interface ModelRequestCompletedPayload {
  schemaVersion: 1
  requestId: string
  conversationId: string
  text: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    cachedInputTokens?: number
  }
  finishReason?: string
}

export interface ContextBoundaryPayload {
  schemaVersion: 1
  boundaryId: string
  conversationId: string
  kind: 'compaction'
  trigger: 'manual' | 'automatic'
  compactedThroughMessageId: string
}

/** Task JSONL envelope */
export interface TaskTraceEnvelope<TEvent extends string = string, TPayload = unknown> {
  time: number
  event: TEvent
  payload: TPayload
}

// ---- RPC & Events ----

/** 列表项摘要（轻量级，用于列表展示） */
export interface ContextTraceListItem {
  requestId: string
  previousRequestId?: string
  conversationId: string
  step: number
  model: string
  provider: string
  /** 存储类型 */
  storageKind: 'baseline' | 'delta'
  storageReason?: 'initial' | 'compaction' | 'history-rewritten'
  /** 是否有模型响应记录 */
  hasResponse: boolean
  /** 摘要信息 */
  itemCount: number
  time: number
}

export interface ContextTraceItemDetail {
  requestId: string
  storage: BaselineStorage | DeltaStorage
  boundary?: ContextBoundaryPayload
  /** 模型响应（仅最终请求） */
  response?: {
    text: string
    usage?: ModelRequestCompletedPayload['usage']
    finishReason?: string
  }
}

/** RPC 端点 */
export interface ListContextTraceInput {
  conversationId: string
  before?: string
  limit?: number
}

export interface ListContextTraceOutput {
  items: ContextTraceListItem[]
  nextCursor?: string
  hasMore: boolean
}

export interface GetContextTraceItemInput {
  conversationId: string
  requestId: string
  itemId: string
}

export type GetContextTraceItemOutput = ContextTraceItemDetail

// ---- Renderer 事件 ----

export interface ContextTraceUpdatedEvent {
  conversationId: string
}
