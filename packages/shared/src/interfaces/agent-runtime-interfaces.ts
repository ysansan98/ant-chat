import type { AddConversationsSchema, AddMessage, McpToolCall, ModelInfo, UpdateConversationsSchema, UpdateMessageSchema } from '../schemas'
import type { AgentMode, AgentPendingAction, AgentTaskSnapshot } from './agent-runtime'
import type { AgentTool } from './agent-tools'
import type { IAttachment, IConversations, IMessage } from './db-types'

// ============================================================
// LoopMessage & RuntimeToolDefinition（从 runtime 提升到 shared）
// ============================================================

export interface LoopMessage {
  role: 'user' | 'assistant' | 'tool'
  content: Array<
    | { type: 'text', text: string }
    | { type: 'tool-call', toolCallId: string, toolName: string, args: Record<string, unknown> }
    | { type: 'tool-result', toolCallId: string, toolName: string, result: unknown, isError?: boolean }
  >
}

export interface RuntimeToolDefinition {
  name: string
  source: AgentTool['source']
  serverName?: string
  description?: string
  inputSchema: {
    type: 'object'
    properties: Record<string, Record<string, unknown>>
    required: string[]
  }
}

// ============================================================
// AI Provider
// ============================================================

export interface IAIStreamChunk {
  content?: Array<{ type: 'text', text: string }>
  reasoningContent?: string
  functionCalls?: Array<{
    id?: string
    serverName?: string
    toolName: string
    args: Record<string, unknown>
  }>
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    cachedInputTokens?: number
  }
}

export interface IAIProvider {
  streamModel: (options: {
    messages: LoopMessage[]
    chatSettings: {
      model: string
      temperature?: number
      maxTokens?: number
      systemPrompt: string
    }
    tools?: RuntimeToolDefinition[]
    abortSignal?: AbortSignal
  }) => AsyncGenerator<IAIStreamChunk>

  complete: (options: {
    messages: Array<{ role: 'user' | 'assistant' | 'system', content: string }>
    chatSettings: {
      model: string
      systemPrompt: string
      maxTokens?: number
    }
    abortSignal?: AbortSignal
  }) => Promise<{ text: string }>
}

// ============================================================
// Session Store
// ============================================================

export interface IConversationQuery {
  getConversationById: (id: string) => Promise<IConversations | null>
  getMessagesByConvId: (convId: string) => Promise<IMessage[]>
}

export type CreateConversationInput = AddConversationsSchema
export type UpdateConversationInput = Omit<UpdateConversationsSchema, 'id'>
export type CreateUserMessageInput = Extract<AddMessage, { role: 'user' }>
export interface CreateAssistantMessageInput {
  conversationId: string
  modelInfo: ModelInfo
}
export type UpdateAssistantMessageInput = Omit<UpdateMessageSchema, 'id'>

export interface ISessionStore extends IConversationQuery {
  getConversation: (id: string) => Promise<IConversations | null>
  createConversation: (data: CreateConversationInput) => Promise<IConversations>
  updateConversation: (id: string, patch: UpdateConversationInput) => Promise<IConversations>
  listConversations: () => Promise<IConversations[]>
  getMessages: (convId: string) => Promise<IMessage[]>
  createUserMessage: (data: CreateUserMessageInput) => Promise<IMessage>
  createAssistantMessage: (data: CreateAssistantMessageInput) => Promise<IMessage>
  updateAssistantMessage: (id: string, patch: UpdateAssistantMessageInput) => Promise<IMessage>
  saveCompactionState: (input: {
    conversationId: string
    summary: string
    compactedAt: number
  }) => Promise<void>
}

// ============================================================
// Path Provider（适配器层使用，不注入 AgentRuntimeConfig）
// ============================================================

export interface IAgentPathProvider {
  getLogsDir: () => string
}

// ============================================================
// Model Resolver（适配器层使用，不注入 AgentRuntimeConfig）
// ============================================================

export interface IModelResolver {
  getModelById: (id: string) => Promise<{ id: string, model: string, name: string, serviceProviderId: string } | null>
  getProviderById: (id: string) => Promise<{ id: string, name: string, apiKey?: string, baseUrl?: string, apiMode?: string } | null>
}

// ============================================================
// Event Emitter
// ============================================================

export interface IAgentEventEmitter {
  emitMessageUpdated?: (message: IMessage) => void | Promise<void>
  emitTaskUpdated: (task: AgentTaskSnapshot) => void | Promise<void>
  emitApprovalRequired: (taskId: string, conversationId: string, pendingAction: AgentPendingAction) => void | Promise<void>
  emitTurnStarted: (params: { conversationId: string, model: { name: string, provider: string, providerId: string } }) => void | Promise<void>
  emitTurnChunk: (params: { conversationId: string, accumulatedText: string, chunk: IAIStreamChunk }) => void | Promise<void>
  emitTurnToolCalls: (params: { conversationId: string, text: string, toolCalls: McpToolCall[] }) => void | Promise<void>
  emitTurnFinished: (params: { conversationId: string, text: string, status: 'success' | 'error' | 'cancel' }) => void | Promise<void>
  emitCompactionSaved: (params: { conversationId: string, summary: string, compactedAt: number }) => void | Promise<void>
}

// ============================================================
// Logger
// ============================================================

export interface ILogger {
  info: (msg: string, ...args: unknown[]) => void
  warn: (msg: string, ...args: unknown[]) => void
  error: (msg: string, ...args: unknown[]) => void
}

/**
 * 按任务的 JSONL 结构化日志写入器。
 *
 * write() 是同步 API（零 await），内部通过 fs.createWriteStream
 * 缓冲写入，libuv 后台异步刷盘，不阻塞事件循环。
 */
export interface ITaskLogger {
  /** 同步写入一条 JSONL 日志事件，无需 await */
  write: (event: string, payload: Record<string, unknown>) => void
  /** 关闭日志流：刷盘 + 释放资源 */
  close: () => void
  /** 日志文件路径（只读） */
  readonly filePath: string
}

// ============================================================
// Factory Types（适配器层使用，不注入 AgentRuntimeConfig）
// ============================================================

export type AIProviderFactory = (modelId: string, modelResolver: IModelResolver) => Promise<IAIProvider>

export type ToolProvider = (workspacePath: string, mode: AgentMode) => Promise<AgentTool[]>

// ============================================================
// Compaction (纯策略回调，外层 onBeforeTurn 中使用)
// ============================================================

export interface CompactionStrategy {
  summarize: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal) => Promise<string>
}

// ============================================================
// Runtime Config（最小化：仅运行环境基础设施）
// ============================================================

export interface AgentRuntimeConfig {
  eventEmitter: IAgentEventEmitter
  logger: ILogger
  /** 创建按任务的结构化日志写入器（每次新任务调用，返回独立的 ITaskLogger 实例） */
  createTaskLogger?: (conversationId: string, userMessageId: string) => ITaskLogger
  /** 当前任务的日志写入器（由 runtime 在启动 task 时设置，loop 层直接消费） */
  taskLogger?: ITaskLogger
  sessionStore?: ISessionStore
  modelResolver?: IModelResolver
  aiProviderFactory?: AIProviderFactory
  toolProvider?: ToolProvider
  compactionStrategy?: CompactionStrategy
}

export interface AgentRuntimeStartTaskOptions {
  prompt: string
  conversationId?: string
  modelId: string
  workspacePath: string
  mode?: AgentMode
  images?: IAttachment[]
  attachments?: IAttachment[]
  referencedFiles?: string[]
  selectedSkill?: string
  chatSettings?: {
    systemPrompt?: string
    temperature?: number
    maxTokens?: number
  }
}

export interface AgentRuntimeStartTaskResult {
  taskId: string
  conversationId: string
  userMessageId: string
  conversation: IConversations
}
