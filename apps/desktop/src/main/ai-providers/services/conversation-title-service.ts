import type { CreateConversationTitleOptions, handleInitConversationTitleOptions } from '@ant-chat/shared'
import type { MultiProvider } from '../multi-provider'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { getModelById, getProviderServiceById, getServiceProviderByModelId } from '@main/db/services'
import { createProvider } from '../factory'
import { formatMessagesForContext } from './utils'

class ConversationTitleService {
  private aiProvider: MultiProvider | null = null

  async initializeProvider(providerId: string) {
    const provider = getProviderServiceById(providerId)
    if (!provider) {
      throw new Error('Provider not found')
    }

    this.aiProvider = await createProvider(provider)
  }

  async createConversationTitle(options: CreateConversationTitleOptions) {
    if (!this.aiProvider) {
      throw new Error('AI provider not set')
    }

    return this.aiProvider.createConversationTitle(options)
  }
}

export async function handleInitConversationTitle(options: handleInitConversationTitleOptions) {
  const { conversationsId, modelId } = options

  const modelInfo = await getModelById(modelId)
  if (!modelInfo) {
    throw new Error(`Model not found for id: ${modelId}`)
  }

  const serviceProvider = getServiceProviderByModelId(modelId)
  if (!serviceProvider) {
    throw new Error(`ServiceProvider not found for modelId: ${modelId}`)
  }

  const messages = await getAppDataServices().messageService.listByConversation(conversationsId)
  const context = formatMessagesForContext(messages)

  const titleService = new ConversationTitleService()
  await titleService.initializeProvider(serviceProvider.id)

  return await titleService.createConversationTitle({
    context,
    model: modelInfo.model,
  })
}
