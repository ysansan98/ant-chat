import type { AgentMode, ChatSettings, CompactionSettingsSchema } from '@ant-chat/shared'

export interface AgentRuntimeStartOptions {
  conversationId: string
  userMessageId: string
  prompt: string
  workspacePath?: string
  mode?: AgentMode
  chatSettings?: Omit<ChatSettings, 'model'> & { modelId: string }
  /** 上下文压缩设置 */
  compaction?: CompactionSettingsSchema
}

export interface AgentRuntimeStartResult {
  taskId: string
}
