import type { AppDataContext } from '@ant-chat/app-data'
import type { RunBuiltinCommandResult } from '@ant-chat/shared'

const DEFAULT_TITLE = 'Untitled'

export async function runNew(params: {
  appDataContext: AppDataContext
  workspacePath: string
  modelConfig: { modelId: string, systemPrompt: string, temperature: number, maxTokens: number }
}): Promise<RunBuiltinCommandResult> {
  const { appDataContext, workspacePath, modelConfig } = params

  const conversation = await appDataContext.conversationRepository.create({
    workspacePath,
    title: DEFAULT_TITLE,
    settings: {
      modelId: modelConfig.modelId,
      systemPrompt: modelConfig.systemPrompt,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  return { conversation, conversationId: conversation.id }
}
