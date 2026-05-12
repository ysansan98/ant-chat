import type { AgentMode, AgentPendingAction, AgentTaskSnapshot } from './agent-runtime'
import type { AgentTool } from './agent-tools'
import type { IConversations, IMessage } from './db-types'

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
// Message Store
// ============================================================

export interface MessageUpdatePatch {
  status?: 'loading' | 'success' | 'error' | 'cancel'
  content?: Array<{ type: 'text', text: string } | { type: 'error', error: string }>
  toolCalls?: Record<string, unknown>[]
  reasoningContent?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    cachedInputTokens?: number
  }
}

export interface IMessageStore {
  createAssistantMessage: (convId: string, provider: string, providerId: string, model: string) => Promise<{ id: string }>
  updateMessage: (messageId: string, patch: MessageUpdatePatch) => Promise<{ id: string }>
  addMessage: (params: {
    convId: string
    role: 'user' | 'assistant'
    status: 'success' | 'error' | 'loading' | 'cancel'
    content: Array<{ type: 'text', text: string }>
  }) => Promise<{ id: string }>
  getMessagesByConvId: (convId: string) => Promise<IMessage[]>
  getConversationById: (id: string) => Promise<IConversations | null>
  updateConversation: (id: string, data: { settings?: Record<string, unknown> }) => Promise<void>
}

// ============================================================
// Event Emitter
// ============================================================

export interface IAgentEventEmitter {
  emitTaskUpdated: (task: AgentTaskSnapshot) => void
  emitApprovalRequired: (taskId: string, conversationId: string, pendingAction: AgentPendingAction) => void
  emitMessageUpdated: (message: IMessage) => void
}

// ============================================================
// Path Provider
// ============================================================

export interface IAgentPathProvider {
  getLogsDir: () => string
}

// ============================================================
// Model Resolver
// ============================================================

export interface IModelResolver {
  getModelById: (id: string) => Promise<{ id: string, model: string, name: string, serviceProviderId: string } | null>
  getProviderById: (id: string) => Promise<{ id: string, name: string, apiKey?: string, baseUrl?: string, apiMode?: string } | null>
}

// ============================================================
// Logger
// ============================================================

export interface ILogger {
  info: (msg: string, ...args: unknown[]) => void
  warn: (msg: string, ...args: unknown[]) => void
  error: (msg: string, ...args: unknown[]) => void
}

// ============================================================
// Factory Types
// ============================================================

export type AIProviderFactory = (modelId: string, modelResolver: IModelResolver) => Promise<IAIProvider>

export type ToolProvider = (workspacePath: string, mode: AgentMode) => Promise<AgentTool[]>

// ============================================================
// Stream Processor
// ============================================================

export interface StreamProcessor {
  /** 每个原始 chunk 都会调用，消费者自行决定提取什么、如何节流持久化 */
  onChunk: (chunk: IAIStreamChunk, assistantMessageId: string) => Promise<void>
  /** 流结束后调用，消费者刷新待持久化的缓存状态 */
  flush: (assistantMessageId: string) => Promise<void>
}

// ============================================================
// Combined Config
// ============================================================

export interface AgentRuntimeConfig {
  messageStore: IMessageStore
  aiProviderFactory: AIProviderFactory
  eventEmitter: IAgentEventEmitter
  pathProvider: IAgentPathProvider
  modelResolver: IModelResolver
  toolProvider: ToolProvider
  logger: ILogger
  isDev: boolean
  streamProcessor?: StreamProcessor
}
