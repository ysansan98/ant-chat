import type { AddMessage, LanguageModelUsage, ModelInfo, ProviderConfigSchema, ReasoningEffortLevel, SecretRef, SecretRequest, SecretRequestField, SecretRequestResult, ToolCallContent, ToolResultContent, UpdateMessageSchema } from '../schemas'
import type { AgentMemoryReader } from './agent-memory'
import type { AgentMode, AgentPendingAction, AgentTaskSnapshot, AgentTurnSource, ToolApprovalWhitelistEntry } from './agent-runtime'
import type { AgentTool } from './agent-tools'
import type { IConversations, IMessage, IMessageContent } from './db-types'
import type { McpServer, McpToolCallResponse } from './mcp'
import type { ImportSkillFromGithubOptions, SkillManifest } from './skill'

// ============================================================
// LoopMessage & RuntimeToolDefinition（从 runtime 提升到 shared）
// ============================================================

export interface LoopMessage {
  role: 'user' | 'assistant' | 'tool'
  content: Array<
    | { type: 'text', text: string }
    | { type: 'image', mimeType: string, data: string }
    | { type: 'file', mimeType: string, data: string }
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
    /** 工具调用执行状态，与消息 schema 的 ToolCallContent.executeState 对齐 */
    executeState?: 'await' | 'executing' | 'completed'
  }>
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    cachedInputTokens?: number
  }
  finishReason?: string
}

export interface IAIProvider {
  streamModel: (options: {
    messages: LoopMessage[]
    modelSettings: {
      model: string
      temperature?: number
      maxOutputTokens?: number
      systemPrompt: string
      /** 推理强度档位（ai-sdk v7 统一参数）。未设置时由厂商默认决定。 */
      reasoningEffort?: ReasoningEffortLevel
    }
    tools?: RuntimeToolDefinition[]
    abortSignal?: AbortSignal
  }) => AsyncGenerator<IAIStreamChunk>

  complete: (options: {
    messages: Array<{ role: 'user' | 'assistant' | 'system', content: string }>
    modelSettings: {
      model: string
      systemPrompt: string
      maxOutputTokens?: number
      /** 推理强度档位（ai-sdk v7 统一参数）。未设置时由厂商默认决定。 */
      reasoningEffort?: ReasoningEffortLevel
    }
    abortSignal?: AbortSignal
  }) => Promise<{ text: string, usage?: LanguageModelUsage }>
}

export type ModelRequestObservation = Parameters<IAIProvider['streamModel']>[0]

export interface AgentObservationSpan {
  /** span 唯一标识，NOOP span 为空字符串 */
  readonly id: string
  complete: (output?: unknown) => void
  fail: (error: unknown) => void
  cancel: (reason?: unknown) => void
}

export interface AgentTurnRecorder {
  startModelRequest: (input: ModelRequestObservation) => AgentObservationSpan
  startToolCall: (input: unknown, parentSpanId?: string) => AgentObservationSpan
  startPolicyDecision: (input: unknown, parentSpanId?: string) => AgentObservationSpan
  recordContextEvent: (event: unknown) => void
  finish: (result: { status: 'success' | 'failed' | 'cancelled', output?: unknown, error?: unknown }) => void
}

export interface AgentObservabilityPort {
  beginTurn: (meta: {
    conversationId: string
    turnId: string
    taskId: string
    source: AgentTurnSource
  }) => AgentTurnRecorder
}

// ============================================================
// Session Store
// ============================================================

export interface IConversationQuery {
  getConversationById: (id: string) => Promise<IConversations | null>
  getMessagesByConvId: (convId: string) => Promise<IMessage[]>
}

export type CreateUserMessageInput = Extract<AddMessage, { role: 'user' }> & { id?: string }
export type CreateToolMessageInput = Extract<AddMessage, { role: 'tool' }>
export type CreateEventMessageInput = Extract<AddMessage, { role: 'event' }>
export interface CreateAssistantMessageInput {
  conversationId: string
  modelInfo: ModelInfo
  turnId?: string
}
export type UpdateAssistantMessageInput = Omit<UpdateMessageSchema, 'id'>
export type UpdateEventMessageInput = Omit<UpdateMessageSchema, 'id'>

export interface ISessionStore extends IConversationQuery {
  getConversation: (id: string) => Promise<IConversations | null>
  listConversations: () => Promise<IConversations[]>
  getMessages: (convId: string) => Promise<IMessage[]>
  createUserMessage: (data: CreateUserMessageInput) => Promise<IMessage>
  createAssistantMessage: (data: CreateAssistantMessageInput) => Promise<IMessage>
  createToolMessage: (data: CreateToolMessageInput) => Promise<IMessage>
  createEventMessage: (data: CreateEventMessageInput) => Promise<IMessage>
  updateAssistantMessage: (id: string, patch: UpdateAssistantMessageInput) => Promise<IMessage>
  updateEventMessage: (id: string, patch: UpdateEventMessageInput) => Promise<IMessage>
  deleteEventMessage: (id: string) => Promise<void>
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

export interface ModelRef {
  providerId: string
  modelId: string
}

export interface ResolvedModel {
  model: AgentModel
  provider: AgentProvider
}

export interface AgentModel {
  id: string
  model: string
  name: string
  providerId: string
  contextLength: number
}

export type AgentProvider = ProviderConfigSchema

export interface IModelCatalog {
  resolveModel: (ref: ModelRef) => Promise<ResolvedModel | null>
  getModel: (providerId: string, modelId: string) => Promise<AgentModel | null>
  getProvider: (providerId: string) => Promise<ProviderConfigSchema | null>
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
  emitTurnFinished: (params: { conversationId: string, turnId: string, text: string, status: 'success' | 'error' | 'cancel', durationMs?: number }) => void | Promise<void>
  emitSecretRequested?: (request: SecretRequest) => void | Promise<void>
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

export interface SecretStore {
  saveProviderApiKey: (input: { providerId: string, apiKey: string }) => Promise<SecretRef>
  getProviderApiKey: (providerId: string) => Promise<string | null>
  deleteProviderApiKey: (providerId: string) => Promise<void>
  createTurnSecret: (input: { runId: string, label: string, value: string }) => Promise<SecretRef>
  resolve: (ref: SecretRef) => Promise<string | null>
  clearTurnSecrets: (runId: string) => Promise<void>
}

export interface SecretRequestInput {
  runId: string
  conversationId: string
  label: string
  fields?: SecretRequestField[]
  reason?: string
}

export interface SecretRequestController {
  requestSecret: (input: SecretRequestInput) => Promise<SecretRequestResult>
  resolveSecretRequest: (input: { requestId: string, value?: string, values?: Record<string, string> }) => void
  rejectSecretRequest: (input: { requestId: string, reason?: string }) => void
}

export interface AgentBrowserRuntimeConfig {
  profilePath: string
  artifactsPath: string
  /** Explicit proxy URL; when set, overrides environment proxy variables. */
  proxyUrl?: string
}

// ============================================================
// Compaction（由 turn 准备阶段的事务协调器调用）
// ============================================================

export interface CompactionStrategy {
  summarize: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal, instruction?: string) => Promise<{
    text: string
    usage?: LanguageModelUsage
  }>
}

export interface AgentRuntimeHost {
  eventEmitter: IAgentEventEmitter
  agentObservability?: AgentObservabilityPort
  sessionStore: ISessionStore
  memoryReader?: AgentMemoryReader
  skillReader?: SkillReader
  mcpClientHub?: RuntimeMcpClientHub
  browser?: AgentBrowserRuntimeConfig
  /** 受控 shell 环境，例如 Desktop 内置 ant-chat launcher 的 PATH。 */
  bashEnvironment?: Record<string, string>
  secretStore?: SecretStore
  secretRequester?: SecretRequestController
  /** 加载附件文件数据（用于将 file_id 转换为 base64 数据） */
  loadFileData?: (fileId: string) => Promise<string | null>
  getToolApprovalWhitelistEntries?: () => ToolApprovalWhitelistEntry[]
  addToolApprovalWhitelistEntry?: (entry: ToolApprovalWhitelistEntry) => void
}

export interface AgentRuntimeOverrides {
  logger?: ILogger
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
  agentObservability?: AgentObservabilityPort
  turnRecorder?: AgentTurnRecorder
  sessionStore?: ISessionStore
  memoryReader?: AgentMemoryReader
  getToolApprovalWhitelistEntries?: () => ToolApprovalWhitelistEntry[]
  addToolApprovalWhitelistEntry?: (entry: ToolApprovalWhitelistEntry) => void
  skillReader?: SkillReader
  mcpClientHub?: RuntimeMcpClientHub
  browser?: AgentBrowserRuntimeConfig
  /** 受控 shell 环境，例如 Desktop 内置 ant-chat launcher 的 PATH。 */
  bashEnvironment?: Record<string, string>
  secretStore?: SecretStore
  secretRequester?: SecretRequestController
  /** 加载附件文件数据（用于将 file_id 转换为 base64 数据） */
  loadFileData?: (fileId: string) => Promise<string | null>
}

export interface AgentRuntimeStartTaskOptions {
  messageContent: IMessageContent
  conversationId: string
  userMessageId: string
  model: AgentModel
  provider: AgentProvider
  workspacePath: string
  aiProvider?: IAIProvider
  mode?: AgentMode
  turnSource?: AgentTurnSource
  modelSettings?: {
    temperature?: number
    maxOutputTokens?: number
    /** 推理强度档位（ai-sdk v7 统一参数）。未设置时由厂商默认决定。 */
    reasoningEffort?: ReasoningEffortLevel
  }
}

export interface AgentRuntimeStartTaskResult {
  taskId: string
  conversationId: string
  userMessageId: string
  conversation: IConversations
}
