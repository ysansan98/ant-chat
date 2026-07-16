import type { AIProviderFactory, IConversations, IMessage, ProviderConfigSchema, UpdateConversationsSchema } from '@ant-chat/shared'
import type { MultiProvider } from '../agent-core'
import type { MessageRepository, ProviderSettingsRepository } from '../data'
import { createProvider } from '../agent-core'

const TITLE_PROMPT_PLACEHOLDER = 'pGqat5J/L@~U'

export const TITLE_PROMPT = `Based on the chat history, give this conversation a name.
Keep it short.
Use 简体中文.
Just provide the name, nothing else.

Here's the conversation:
<conversation-contents>
--------------------------------
${TITLE_PROMPT_PLACEHOLDER}
--------------------------------
</conversation-contents>
Only give the name, nothing else.
The name is:
`

export interface ConversationTitleGenerator {
  updateTitle: (conversationsId: string, modelRef: { providerId: string, modelId: string }) => Promise<IConversations>
}

export interface ConversationTitleGeneratorDependencies {
  providerSettingsRepository: ProviderSettingsRepository
  messageRepository: MessageRepository
  updateConversation: (input: UpdateConversationsSchema) => Promise<IConversations>
  aiProviderFactory?: AIProviderFactory
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
    aiProvider = deps.aiProviderFactory
      ? await deps.aiProviderFactory({ model: { id: '', model: '', name: '', providerId: provider.id, contextLength: 0 }, provider }) as MultiProvider
      : await createProvider(provider as ProviderConfigSchema)
  }

  return {
    async updateTitle(conversationsId, modelRef) {
      const { providerId, modelId } = modelRef
      const modelInfo = deps.providerSettingsRepository.getModel(providerId, modelId)
      if (!modelInfo) {
        throw new Error(`Model not found: ${providerId}/${modelId}`)
      }

      const providerConfig = deps.providerSettingsRepository.getProviderById(providerId)
      if (!providerConfig) {
        throw new Error(`ProviderConfig not found: ${providerId}`)
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

      return deps.updateConversation({ id: conversationsId, title })
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
