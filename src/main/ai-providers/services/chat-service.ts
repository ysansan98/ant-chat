import type { CreateConversationTitleOptions, handleChatCompletionsOptions, handleInitConversationTitleOptions, SendChatCompletionsOptions, TextContent } from '@ant-chat/shared'
import type { AIProvider, StreamChunk } from '../providers/interface'
import { createAIMessage, getMessagesByConvId, getModelById, getProviderServiceById, getServiceProviderByModelId, updateMessage } from '@main/db/services'
import { clientHub } from '@main/mcpClientHub'
import { mainEmitter } from '@main/utils/ipc-events-bus'
import { logger } from '@main/utils/logger'
import { getMainWindow } from '@main/window'
import { AIProviderMapping } from '../providers'
import { StreamAbortController } from '../utils/StreamAbortController'
import { formatMessagesForContext } from './utils'

class ChatService {
  private aiProvider: AIProvider | null = null

  async initializeProvider(providerId: string) {
    const provider = getProviderServiceById(providerId)
    if (!provider) {
      throw new Error('Provider not found')
    }

    if (!(provider.apiMode in AIProviderMapping)) {
      throw new Error(`not support apiMode: ${provider.apiMode}`)
    }

    const aiProvider = new AIProviderMapping[provider.apiMode]({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
    })
    this.aiProvider = aiProvider
  }

  async sendChatCompletions(options: SendChatCompletionsOptions) {
    if (!this.aiProvider) {
      throw new Error('AI provider not set')
    }

    return await this.aiProvider.sendChatCompletions(options)
  }

  async createConversationTitle(options: CreateConversationTitleOptions) {
    if (!this.aiProvider) {
      throw new Error('AI provider not set')
    }

    return this.aiProvider.createConversationTitle(options)
  }
}

export async function handleChatCompletions(options: handleChatCompletionsOptions) {
  const { conversationsId, chatSettings } = options
  const modelInfo = await getModelById(chatSettings.modelId)
  if (!modelInfo) {
    throw new Error(`Model not found for id: ${chatSettings.modelId}`)
  }

  const providerServiceInfo = await getProviderServiceById(modelInfo?.serviceProviderId || '')
  if (!providerServiceInfo) {
    throw new Error(`ServiceProvider not found for modelId: ${modelInfo.id}`)
  }

  const messages = await getMessagesByConvId(conversationsId)

  const chatService = new ChatService()

  chatService.initializeProvider(modelInfo.serviceProviderId)
  const mcpTools = clientHub.getAllAvailableToolsList()
  const mainWindow = getMainWindow()

  if (!mainWindow) {
    throw new Error('not found mainWindow')
  }

  const aiMessage = await createAIMessage(
    conversationsId,
    {
      provider: providerServiceInfo.name,
      model: modelInfo.name,
    },
  )

  mainEmitter.send(mainWindow.webContents, 'chat:stream-message', aiMessage)

  let stream: AsyncIterable<StreamChunk> | null = null
  const streamAbortController = new StreamAbortController(conversationsId)

  try {
    stream = await chatService.sendChatCompletions(
      {
        messages,
        chatSettings: {
          ...chatSettings,
          model: modelInfo.model,
        },
        mcpTools,
        abortSignal: streamAbortController.signal,
      },
    )
  }
  catch (e) {
    console.error('throw error for sendChatCompletions', e)
    aiMessage.content.push({ type: 'error', error: (e as Error).message })
    const errorMessage = await updateMessage({ ...aiMessage, role: 'assistant', status: 'error' })
    mainEmitter.send(mainWindow.webContents, 'chat:stream-message', errorMessage)
    return
  }

  try {
    for await (const chunk of stream) {
      streamAbortController.signal.throwIfAborted()

      const { reasoningContent, content, functionCalls } = chunk
      if (reasoningContent) {
        aiMessage.reasoningContent += reasoningContent
      }

      if (content) {
        const aiContent = aiMessage.content
        // 合并连续的文本消息
        content.forEach((item) => {
          if (item.type === 'text' && aiContent.length > 0 && aiContent[aiContent.length - 1].type === 'text') {
            (aiContent[aiContent.length - 1] as TextContent).text += item.text
          }
          else {
            aiContent.push(item)
          }
        })
      }

      if (functionCalls) {
        logger.debug('functionCalls => ', functionCalls.length)
        aiMessage.mcpTool = functionCalls
      }

      // 合并到数据库
      const updatedMessage = await updateMessage({
        ...aiMessage,
        role: 'assistant',
        status: 'typing',
      })

      // 将最新的消息推送给前端
      mainEmitter.send(mainWindow.webContents, 'chat:stream-message', updatedMessage)
      logger.debug('chat:stream-message:', JSON.stringify(updatedMessage))
      // console.log('chat:stream-message:', JSON.stringify(updatedMessage, null, 2))
    }
  }
  catch (e) {
    aiMessage.content.push({ type: 'error', error: (e as Error).message })
    const errorMessage = await updateMessage({ ...aiMessage, role: 'assistant', status: 'error' })
    mainEmitter.send(mainWindow.webContents, 'chat:stream-message', errorMessage)
    return
  }

  const finalMessage = await updateMessage({ id: aiMessage.id, role: 'assistant', status: 'success' })

  mainEmitter.send(mainWindow.webContents, 'chat:stream-message', { ...finalMessage, status: 'success' })
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

  const { model } = modelInfo

  const messages = await getMessagesByConvId(conversationsId)

  const chatService = new ChatService()
  chatService.initializeProvider(serviceProvider?.id)

  const context = formatMessagesForContext(messages)

  return await chatService.createConversationTitle({ context, model })
}
