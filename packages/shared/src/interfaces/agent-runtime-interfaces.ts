import type { AddConversationsSchema, AddMessage, ModelInfo, ServiceProviderSchema, ToolCallContent, ToolResultContent, UpdateConversationsSchema, UpdateMessageSchema } from '../schemas'
import type { AgentProfileReader } from './agent-profile'
import type { AgentMode, AgentPendingAction, AgentTaskSnapshot, ToolApprovalWhitelistEntry } from './agent-runtime'
import type { AgentTool } from './agent-tools'
import type { IAttachment, IConversations, IMessage } from './db-types'
import type { McpServer, McpToolCallResponse } from './mcp'
import type { ImportSkillFromGithubOptions, SkillManifest } from './skill'

// ============================================================
// LoopMessage & RuntimeToolDefinition（从 runtime 提升到 shared）
// ============================================================

export interface LoopMessage {
  role: 'user' | 'assistant' | 'tool'
  content: Array<
    | { type: 'text', text: string }
    | ToolCallContent
    | ToolResultContent
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
export type CreateToolMessageInput = Extract<AddMessage, { role: 'tool' }>
export type CreateEventMessageInput = Extract<AddMessage, { role: 'event' }>
export interface CreateAssistantMessageInput {
  conversationId: string
  modelInfo: ModelInfo
  turnId?: string
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
  createToolMessage: (data: CreateToolMessageInput) => Promise<IMessage>
  createEventMessage: (data: CreateEventMessageInput) => Promise<IMessage>
  updateAssistantMessage: (id: string, patch: UpdateAssistantMessageInput) => Promise<IMessage>
}

// ============================================================
// Path Provider（适配器层使用，不注入 AgentRuntimeConfig）
// ============================================================

export interface IAgentPathProvider {
  getLogsDir: () => string
}

// ============================================================
// Model Catalog
// ============================================================

export interface AgentModel {
  id: string
  model: string
  name: string
  serviceProviderId: string
}

export type AgentProvider = ServiceProviderSchema

export interface IModelCatalog {
  getModelById: (id: string) => Promise<{ id: string, model: string, name: string, serviceProviderId: string } | null>
  getProviderById: (id: string) => Promise<ServiceProviderSchema | null>
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
  emitTurnToolCalls: (params: { conversationId: string, text: string, toolCalls: ToolCallContent[] }) => void | Promise<void>
  emitTurnToolResults?: (params: { conversationId: string, results: ToolResultContent[] }) => void | Promise<void>
  emitTurnFinished: (params: { conversationId: string, text: string, status: 'success' | 'error' | 'cancel' }) => void | Promise<void>
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

export type AIProviderFactory = (input: { model: AgentModel, provider: AgentProvider }) => Promise<IAIProvider>

export interface SkillReader {
  getSkillsRoot: () => string
  getEnabledSkills: () => Promise<SkillManifest[]>
  readSkillMarkdown: (name: string) => Promise<string>
  importFromGithub: (options: ImportSkillFromGithubOptions) => Promise<SkillManifest>
}

export interface RuntimeMcpClientHub {
  connections: Array<{ server: Pick<McpServer, 'name' | 'status' | 'tools'> }>
  callTool: (serverName: string, toolName: string, toolArguments?: Record<string, unknown>) => Promise<McpToolCallResponse>
}

// ============================================================
// Compaction (纯策略回调，外层 onBeforeTurn 中使用)
// ============================================================

export interface CompactionStrategy {
  summarize: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal) => Promise<string>
}

export interface AgentRuntimeHost {
  eventEmitter: IAgentEventEmitter
  /** 创建按任务的结构化日志写入器（每次新任务调用，返回独立的 ITaskLogger 实例） */
  createTaskLogger?: (conversationId: string, userMessageId: string) => ITaskLogger
  sessionStore: ISessionStore
  modelCatalog: IModelCatalog
  profileReader?: AgentProfileReader
  skillReader?: SkillReader
  mcpClientHub?: RuntimeMcpClientHub
  getToolApprovalWhitelistEntries?: () => ToolApprovalWhitelistEntry[]
}

export interface AgentRuntimeOverrides {
  logger?: ILogger
  aiProviderFactory?: AIProviderFactory
  compactionStrategy?: CompactionStrategy
}

export interface AgentRuntimeOptions {
  host: AgentRuntimeHost
  overrides?: AgentRuntimeOverrides
}

// ============================================================
// Runtime Config（agent-core 内部扁平形态）
// ============================================================

export interface AgentRuntimeConfig extends AgentRuntimeOverrides {
  eventEmitter: IAgentEventEmitter
  /** 创建按任务的结构化日志写入器（每次新任务调用，返回独立的 ITaskLogger 实例） */
  createTaskLogger?: (conversationId: string, userMessageId: string) => ITaskLogger
  /** 当前任务的日志写入器（由 runtime 在启动 task 时设置，loop 层直接消费） */
  taskLogger?: ITaskLogger
  sessionStore?: ISessionStore
  modelCatalog?: IModelCatalog
  profileReader?: AgentProfileReader
  getToolApprovalWhitelistEntries?: () => ToolApprovalWhitelistEntry[]
  skillReader?: SkillReader
  mcpClientHub?: RuntimeMcpClientHub
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
