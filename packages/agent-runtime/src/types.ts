import type { AgentMode, ChatSettings, CompactionSettingsSchema } from '@ant-chat/shared'

export interface RuntimeStartInput {
  conversationId: string
  userMessageId: string
  prompt: string
  referencedFiles?: string[]
  selectedSkill?: string
  workspacePath?: string
  executionMode?: AgentMode
  modelConfig?: Omit<ChatSettings, 'model'> & { modelId: string }
  compaction?: CompactionSettingsSchema
}

export interface RuntimeStartResult {
  taskId: string
}
