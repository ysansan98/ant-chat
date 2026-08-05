import type { ReasoningEffortLevel, RunBuiltinCommandResult } from '@ant-chat/shared'
import type { ConversationLifecycle } from '../../conversations/conversationLifecycle'

const DEFAULT_TITLE = 'Untitled'

export async function runNew(params: {
  conversationLifecycle: ConversationLifecycle
  workspacePath: string
  modelConfig: { modelId: string, providerId: string, reasoningEffort?: ReasoningEffortLevel }
  conversationInstructions?: string
}): Promise<RunBuiltinCommandResult> {
  const { conversationLifecycle, workspacePath, modelConfig, conversationInstructions } = params

  const conversation = await conversationLifecycle.create({
    workspacePath,
    title: DEFAULT_TITLE,
    conversationInstructions: conversationInstructions ?? '',
    settings: {
      modelId: modelConfig.modelId,
      providerId: modelConfig.providerId,
      reasoningEffort: modelConfig.reasoningEffort,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  return { status: 'success', conversation, conversationId: conversation.id }
}
