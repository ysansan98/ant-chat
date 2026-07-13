import type { AgentMode, ConversationsSettingsSchema, IMessageContent, StartAgentTurnOptions } from '@ant-chat/shared'

interface BuildTurnInputOptions {
  conversationId?: string
  messageContent: IMessageContent
  workspacePath: string
  settings: ConversationsSettingsSchema
  mode: AgentMode
  /** 仅新建 conversation 时消费 */
  conversationInstructions?: string
}

export function buildTurnInput(options: BuildTurnInputOptions): StartAgentTurnOptions {
  return {
    conversationId: options.conversationId,
    messageContent: options.messageContent,
    mode: options.mode,
    workspacePath: options.workspacePath,
    conversationInstructions: options.conversationInstructions,
    modelConfig: {
      modelId: options.settings.modelId,
      providerId: options.settings.providerId,
      temperature: options.settings.temperature,
      maxOutputTokens: options.settings.maxOutputTokens,
      reasoningEffort: options.settings.reasoningEffort,
    },
  }
}
