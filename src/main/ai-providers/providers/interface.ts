import type { CreateConversationTitleOptions, McpToolCall, MessageContent, SendChatCompletionsOptions } from '@ant-chat/shared'

export interface ProviderOptions {
  baseUrl: string
  apiKey: string
}

export interface AIProvider {
  sendChatCompletions: (options: SendChatCompletionsOptions) => AsyncIterable<StreamChunk>
  createConversationTitle: (options: CreateConversationTitleOptions) => Promise<string>
}

export interface AIProviderConstructor {
  new (options: ProviderOptions): AIProvider
}

export interface StreamChunk {
  content: MessageContent
  reasoningContent: string
  functionCalls?: McpToolCall[]
}
