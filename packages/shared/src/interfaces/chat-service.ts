import type { ChatFeatures, IMessage } from './db-types'
import type { McpTool } from './mcp'

export interface ChatSettings {
  systemPrompt: string
  temperature: number
  maxTokens: number
  model: string
  features: ChatFeatures
}

export interface SendChatCompletionsOptions {
  messages: IMessage[]
  chatSettings: ChatSettings
  tools?: McpTool[]
  abortSignal?: AbortSignal
}

export interface handleChatCompletionsOptions {
  conversationsId: string
  chatSettings: Omit<ChatSettings, 'model'> & { modelId: string }
}

export interface handleInitConversationTitleOptions {
  conversationsId: string
  modelId: string
}

export interface CreateConversationTitleOptions {
  context: string
  model: string
}
