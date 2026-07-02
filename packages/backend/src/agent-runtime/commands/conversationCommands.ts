import type { RunBuiltinCommandResult } from '@ant-chat/shared'
import type { AppDataContext } from '../../data'

const DEFAULT_TITLE = 'Untitled'

export async function runNew(params: {
  appDataContext: AppDataContext
  workspacePath: string
  modelConfig: { modelId: string, providerId: string, systemPrompt: string, temperature: number, maxTokens: number }
}): Promise<RunBuiltinCommandResult> {
  const { appDataContext, workspacePath, modelConfig } = params

  const conversation = await appDataContext.conversationRepository.create({
    workspacePath,
    title: DEFAULT_TITLE,
    settings: {
      modelId: modelConfig.modelId,
      providerId: modelConfig.providerId,
      systemPrompt: modelConfig.systemPrompt,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  return { status: 'success', conversation, conversationId: conversation.id }
}
