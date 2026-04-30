import type { CreateConversationTitleOptions, handleChatCompletionsOptions, handleInitConversationTitleOptions, McpToolCall, MessageContent, SendChatCompletionsOptions, TextContent } from '@ant-chat/shared'
import type { LanguageModelUsage } from 'ai'
import type { MultiProvider } from '../multi-provider'
import process from 'node:process'
import { createAIMessage, getMessagesByConvId, getModelById, getProviderServiceById, getServiceProviderByModelId, updateMessage } from '@main/db/services'
import { clientHub } from '@main/mcpClientHub'
import { sendToRenderer } from '@main/utils/ipc-events'
import { logger } from '@main/utils/logger'
import { getMainWindow } from '@main/window'
import { createProvider } from '../factory'
import { StreamAbortController } from '../utils/StreamAbortController'
import { formatMessagesForContext } from './utils'

// 定义 StreamChunk 类型
interface StreamChunk {
  content: MessageContent
  reasoningContent?: string
  functionCalls?: McpToolCall[]
  usage?: LanguageModelUsage
}

class ChatService {
  private aiProvider: MultiProvider | null = null

  async initializeProvider(providerId: string) {
    const provider = getProviderServiceById(providerId)
    if (!provider) {
      throw new Error('Provider not found')
    }

    const aiProvider = await createProvider(provider)
    this.aiProvider = aiProvider
  }

  async sendChatCompletions(options: SendChatCompletionsOptions) {
    if (!this.aiProvider) {
      throw new Error('AI provider not set')
    }

    return this.aiProvider.sendChatCompletions(options)
  }

  async createConversationTitle(options: CreateConversationTitleOptions) {
    if (!this.aiProvider) {
      throw new Error('AI provider not set')
    }

    return this.aiProvider.createConversationTitle(options)
  }

  /**
   * 验证提供商连接
   */
  async validateProviderConnection(model: string) {
    if (!this.aiProvider) {
      return { success: false, error: 'AI provider not set' }
    }
    return await this.aiProvider.validateConnection(model)
  }
}

export async function handleChatCompletions(options: handleChatCompletionsOptions) {
  const { conversationsId, chatSettings } = options
  const modelInfo = await getModelById(chatSettings.modelId)
  if (!modelInfo) {
    throw new Error(`Model not found for id: ${chatSettings.modelId}`)
  }

  const providerServiceInfo = getProviderServiceById(modelInfo?.serviceProviderId || '')
  if (!providerServiceInfo) {
    throw new Error(`ServiceProvider not found for modelId: ${modelInfo.id}`)
  }

  const messages = await getMessagesByConvId(conversationsId)

  const chatService = new ChatService()

  await chatService.initializeProvider(modelInfo.serviceProviderId)
  const mcpTools = clientHub.getAllAvailableToolsList()
  logger.info('Available MCP tools:', mcpTools.map(tool => tool.name))
  const mainWindow = getMainWindow()

  if (!mainWindow) {
    throw new Error('not found mainWindow')
  }

  const aiMessage = await createAIMessage(
    conversationsId,
    {
      provider: providerServiceInfo.name,
      providerId: providerServiceInfo.id,
      model: modelInfo.name,
    },
  )

  sendToRenderer(mainWindow.webContents, 'chat:stream-message', aiMessage)

  let stream: AsyncIterable<StreamChunk> | null = null
  const streamAbortController = new StreamAbortController(conversationsId)

  try {
    stream = await chatService.sendChatCompletions(
      {
        messages,
        chatSettings: {
          ...chatSettings,
          model: modelInfo.model,
          systemPrompt: appendPlatformDeclaration(chatSettings.systemPrompt),
        },
        tools: mcpTools,
        abortSignal: streamAbortController.signal,
      },
    )
  }
  catch (e) {
    logger.error('throw error for sendChatCompletions', e)
    aiMessage.content.push({ type: 'error', error: (e as Error).message })
    const errorMessage = await updateMessage({ ...aiMessage, role: 'assistant', status: 'error' })
    sendToRenderer(mainWindow.webContents, 'chat:stream-message', errorMessage)
    return
  }
  if (!stream) {
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
        aiMessage.mcpTool = functionCalls
      }

      if (chunk.usage) {
        aiMessage.usage = chunk.usage
      }

      // 合并到数据库
      const updatedMessage = await updateMessage({
        ...aiMessage,
        role: 'assistant',
        status: 'typing',
      })

      // 将最新的消息推送给前端
      sendToRenderer(mainWindow.webContents, 'chat:stream-message', updatedMessage)
      logger.debug('chat:stream-message:', JSON.stringify(updatedMessage))
    }
  }
  catch (e) {
    aiMessage.content.push({ type: 'error', error: (e as Error).message })
    const errorMessage = await updateMessage({ ...aiMessage, role: 'assistant', status: 'error' })
    sendToRenderer(mainWindow.webContents, 'chat:stream-message', errorMessage)
    return
  }

  const finalMessage = await updateMessage({ id: aiMessage.id, role: 'assistant', status: 'success' })

  sendToRenderer(mainWindow.webContents, 'chat:stream-message', { ...finalMessage, status: 'success' })
}

export function appendPlatformDeclaration(systemPrompt: string): string {
  const platform = process.platform === 'darwin'
    ? 'macOS'
    : process.platform === 'win32'
      ? 'Windows'
      : null

  if (!platform) {
    return systemPrompt
  }

  const declaration = `Current application platform: ${platform}. Supported agent platforms are macOS and Windows only.`
  return systemPrompt.trim()
    ? `${systemPrompt.trim()}\n\n${declaration}`
    : declaration
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
  await chatService.initializeProvider(serviceProvider?.id)

  const context = formatMessagesForContext(messages)

  return await chatService.createConversationTitle({ context, model })
}
