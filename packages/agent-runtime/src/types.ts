import type { AgentMode, ChatSettings, CompactionSettingsSchema } from '@ant-chat/shared'

export interface AgentRuntimeStartOptions {
  conversationId: string
  userMessageId: string
  prompt: string
  referencedFiles?: string[]
  selectedSkill?: string
  workspacePath?: string
  mode?: AgentMode
  chatSettings?: Omit<ChatSettings, 'model'> & { modelId: string }
  compaction?: CompactionSettingsSchema
}

export interface AgentRuntimeStartResult {
  taskId: string
}
