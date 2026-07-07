import type { AgentMode, ChatFeatures, ConversationsSettingsSchema, IMessageContent, StartAgentTurnOptions } from '@ant-chat/shared'

interface BuildTurnInputOptions {
  conversationId?: string
  text: string
  content?: IMessageContent
  referencedFiles?: string[]
  selectedSkill?: string
  workspacePath: string
  settings: ConversationsSettingsSchema
  features: ChatFeatures
  mode: AgentMode
}

export function buildTurnInput(options: BuildTurnInputOptions): StartAgentTurnOptions {
  return {
    conversationId: options.conversationId,
    prompt: options.text,
    content: options.content ?? [{ type: 'text', text: options.text }],
    referencedFiles: options.referencedFiles ?? [],
    mode: options.mode,
    workspacePath: options.workspacePath,
    modelConfig: {
      ...options.settings,
      features: options.features,
    },
  }
}
