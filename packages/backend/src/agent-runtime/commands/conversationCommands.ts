import type { ReasoningEffortLevel, RunBuiltinCommandResult } from '@ant-chat/shared'
import type { AppDataContext } from '../../data'

const DEFAULT_TITLE = 'Untitled'

export async function runNew(params: {
  appDataContext: AppDataContext
  workspacePath: string
  modelConfig: { modelId: string, providerId: string, temperature: number, maxOutputTokens: number, reasoningEffort?: ReasoningEffortLevel }
  conversationInstructions?: string
}): Promise<RunBuiltinCommandResult> {
  const { appDataContext, workspacePath, modelConfig, conversationInstructions } = params

  const conversation = await appDataContext.conversationRepository.create({
    workspacePath,
    title: DEFAULT_TITLE,
    conversationInstructions: conversationInstructions ?? '',
    settings: {
      modelId: modelConfig.modelId,
      providerId: modelConfig.providerId,
      temperature: modelConfig.temperature,
      maxOutputTokens: modelConfig.maxOutputTokens,
      reasoningEffort: modelConfig.reasoningEffort,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  return { status: 'success', conversation, conversationId: conversation.id }
}
