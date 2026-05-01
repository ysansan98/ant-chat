import type { AgentMode, ChatSettings } from '@ant-chat/shared'

export interface AgentRuntimeStartOptions {
  conversationId: string
  userMessageId: string
  prompt: string
  workspacePath?: string
  mode?: AgentMode
  chatSettings?: Omit<ChatSettings, 'model'> & { modelId: string }
}

export interface AgentRuntimeStartResult {
  taskId: string
}
