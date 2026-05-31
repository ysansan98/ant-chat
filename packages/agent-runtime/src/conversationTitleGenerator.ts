import type { MultiProvider } from '@ant-chat/agent-core'
import type { ConversationRepository, MessageRepository, ProviderSettingsRepository } from '@ant-chat/app-data'
import type { IConversations, IMessage } from '@ant-chat/shared'
import { createProvider } from '@ant-chat/agent-core'

const TITLE_PROMPT_PLACEHOLDER = 'pGqat5J/L@~U'

export const TITLE_PROMPT = `Based on the chat history, give this conversation a name.
Keep it short.
Use 简体中文.
Just provide the name, nothing else.

Here's the conversation:
--------------------------------
${TITLE_PROMPT_PLACEHOLDER}
--------------------------------
Use 简体中文.
Only give the name, nothing else.
The name is:
`

export interface ConversationTitleGenerator {
  updateTitle: (conversationsId: string, modelId: string) => Promise<IConversations>
}

export interface ConversationTitleGeneratorDependencies {
  providerSettingsRepository: ProviderSettingsRepository
  messageRepository: MessageRepository
  conversationRepository: ConversationRepository
}

export function createConversationTitleGenerator(
  deps: ConversationTitleGeneratorDependencies,
): ConversationTitleGenerator {
  let aiProvider: MultiProvider | null = null

  async function initializeProvider(providerId: string) {
    const provider = deps.providerSettingsRepository.getProviderById(providerId)
    if (!provider) {
      throw new Error('Provider not found')
    }
    aiProvider = await createProvider(provider)
  }

  return {
    async updateTitle(conversationsId, modelId) {
      const modelInfo = deps.providerSettingsRepository.getModelById(modelId)
      if (!modelInfo) {
        throw new Error(`Model not found for id: ${modelId}`)
      }

      const providerConfig = deps.providerSettingsRepository.getProviderByModelId(modelId)
      if (!providerConfig) {
        throw new Error(`ProviderConfig not found for modelId: ${modelId}`)
      }

      const messages = await deps.messageRepository.listByConversation(conversationsId)
      const context = formatMessagesForContext(messages)

      await initializeProvider(providerConfig.id)

      if (!aiProvider) {
        throw new Error('AI provider not set')
      }

      const title = await aiProvider.createConversationTitle({
        context,
        model: modelInfo.model,
      })

      return deps.conversationRepository.update({ id: conversationsId, title })
    },
  }
}

export function formatMessagesForContext(messages: IMessage[]): string {
  const textList = messages.map(
    message => message.content
      .filter(item => item.type === 'text')
      .reduce((acc, item) => {
        return acc + item.text
      }, `Role: ${message.role}\n`),
  )

  return TITLE_PROMPT.replace(
    TITLE_PROMPT_PLACEHOLDER,
    textList.join('\n----------\n'),
  )
}
