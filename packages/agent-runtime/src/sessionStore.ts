import type { AppDataServices } from '@ant-chat/app-data'
import type { CreateAssistantMessageInput, CreateConversationInput, CreateEventMessageInput, CreateToolMessageInput, CreateUserMessageInput, ISessionStore, UpdateAssistantMessageInput, UpdateConversationInput } from '@ant-chat/shared'

export function createAppDataSessionStore(appDataServices: AppDataServices): ISessionStore {
  const { conversationService, messageService } = appDataServices

  return {
    async getConversation(id) {
      return await getNullableConversation(conversationService, id)
    },
    async getConversationById(id) {
      return await getNullableConversation(conversationService, id)
    },
    async createConversation(data: CreateConversationInput) {
      return await conversationService.create(data)
    },
    async updateConversation(id: string, patch: UpdateConversationInput) {
      return await conversationService.update({ id, ...patch })
    },
    async listConversations() {
      return (await conversationService.list(0, 1000)).data
    },
    async getMessages(convId) {
      return await messageService.listByConversation(convId)
    },
    async getMessagesByConvId(convId) {
      return await messageService.listByConversation(convId)
    },
    async createUserMessage(data: CreateUserMessageInput) {
      return await messageService.create(data)
    },
    async createAssistantMessage(data: CreateAssistantMessageInput) {
      return await messageService.create({
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
      return await messageService.create(data)
    },
    async createEventMessage(data: CreateEventMessageInput) {
      return await messageService.create(data)
    },
    async updateAssistantMessage(id: string, patch: UpdateAssistantMessageInput) {
      return await messageService.update({ id, ...patch })
    },
  }
}

async function getNullableConversation(
  conversationService: AppDataServices['conversationService'],
  id: string,
) {
  try {
    return await conversationService.getById(id)
  }
  catch {
    return null
  }
}
