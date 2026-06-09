import type { AppDataContext } from '@ant-chat/app-data'
import type { CreateAssistantMessageInput, CreateConversationInput, CreateEventMessageInput, CreateToolMessageInput, CreateUserMessageInput, ISessionStore, UpdateAssistantMessageInput, UpdateConversationInput, UpdateEventMessageInput } from '@ant-chat/shared'

export function createAppDataSessionStore(appDataContext: AppDataContext): ISessionStore {
  const { conversationRepository, messageRepository } = appDataContext

  return {
    async getConversation(id) {
      return await getNullableConversation(conversationRepository, id)
    },
    async getConversationById(id) {
      return await getNullableConversation(conversationRepository, id)
    },
    async createConversation(data: CreateConversationInput) {
      return await conversationRepository.create(data)
    },
    async updateConversation(id: string, patch: UpdateConversationInput) {
      return await conversationRepository.update({ id, ...patch })
    },
    async listConversations() {
      return (await conversationRepository.list(0, 1000)).data
    },
    async getMessages(convId) {
      return await messageRepository.listByConversation(convId)
    },
    async getMessagesByConvId(convId) {
      return await messageRepository.listByConversation(convId)
    },
    async createUserMessage(data: CreateUserMessageInput) {
      return await messageRepository.create(data)
    },
    async createAssistantMessage(data: CreateAssistantMessageInput) {
      return await messageRepository.create({
        convId: data.conversationId,
        content: [],
        role: 'assistant',
        status: 'loading',
        modelInfo: data.modelInfo,
        reasoningContent: '',
        turnId: data.turnId,
      })
    },
    async createToolMessage(data: CreateToolMessageInput) {
      return await messageRepository.create(data)
    },
    async createEventMessage(data: CreateEventMessageInput) {
      return await messageRepository.create(data)
    },
    async updateAssistantMessage(id: string, patch: UpdateAssistantMessageInput) {
      return await messageRepository.update({ id, ...patch })
    },
    async updateEventMessage(id: string, patch: UpdateEventMessageInput) {
      return await messageRepository.update({ id, ...patch })
    },
  }
}

async function getNullableConversation(
  conversationRepository: AppDataContext['conversationRepository'],
  id: string,
) {
  try {
    return await conversationRepository.getById(id)
  }
  catch {
    return null
  }
}
