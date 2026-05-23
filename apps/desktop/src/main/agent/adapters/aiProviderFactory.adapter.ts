import type { AIProviderFactory, IAIProvider } from '@ant-chat/shared'
import { createProvider } from '@main/ai-providers/factory'
import { getProviderServiceById } from '@main/db/services'

export const createDbAIProvider: AIProviderFactory = async (modelId, modelResolver) => {
  const model = await modelResolver.getModelById(modelId)
  if (!model)
    throw new Error('Model not found')
  const provider = getProviderServiceById(model.serviceProviderId)
  if (!provider)
    throw new Error('Provider not found')
  const multiProvider = await createProvider(provider)
  return multiProvider as unknown as IAIProvider
}
