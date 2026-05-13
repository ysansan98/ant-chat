import type { McpToolCall } from '../schemas'
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
// Conversation Query (只读)
// ============================================================

export interface IConversationQuery {
  getConversationById: (id: string) => Promise<IConversations | null>
  getMessagesByConvId: (convId: string) => Promise<IMessage[]>
}

// ============================================================
// Event Emitter
// ============================================================

export interface IAgentEventEmitter {
  emitTaskUpdated: (task: AgentTaskSnapshot) => void
  emitApprovalRequired: (taskId: string, conversationId: string, pendingAction: AgentPendingAction) => void
  emitTurnStarted: (params: { conversationId: string, model: { name: string, provider: string, providerId: string } }) => void
  emitTurnChunk: (params: { conversationId: string, accumulatedText: string, chunk: IAIStreamChunk }) => void
  emitTurnToolCalls: (params: { conversationId: string, text: string, toolCalls: McpToolCall[] }) => void
  emitTurnFinished: (params: { conversationId: string, text: string, status: 'success' | 'error' | 'cancel' }) => void
  emitCompactionSaved: (params: { conversationId: string, summary: string, compactedAt: number }) => void
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

export interface CompactionStrategy {
  summarize: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal) => Promise<string>
}

// ============================================================
// Combined Config
// ============================================================

export interface AgentRuntimeConfig {
  conversationQuery: IConversationQuery
  aiProviderFactory: AIProviderFactory
  eventEmitter: IAgentEventEmitter
  pathProvider: IAgentPathProvider
  modelResolver: IModelResolver
  toolProvider: ToolProvider
  logger: ILogger
  isDev: boolean
  compactionStrategy?: CompactionStrategy
  systemPrompt?: string
}
