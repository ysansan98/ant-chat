import type { CreateAssistantMessageInput, CreateConversationInput, CreateUserMessageInput, ISessionStore, UpdateAssistantMessageInput, UpdateConversationInput } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'

export function createElectronSessionStore(): ISessionStore {
  const { conversationService, messageService } = getAppDataServices()

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
      return await messageService.createAssistant(data.conversationId, data.modelInfo)
    },
    async updateAssistantMessage(id: string, patch: UpdateAssistantMessageInput) {
      return await messageService.update({ id, ...patch })
    },
    async saveCompactionState(input) {
      const conv = await conversationService.getById(input.conversationId)
      await conversationService.update({
        id: input.conversationId,
        settings: {
          ...conv.settings,
          lastCompactedAt: input.compactedAt,
          lastCompactionSummary: input.summary,
        },
      })
    },
  }
}

async function getNullableConversation(conversationService: ReturnType<typeof getAppDataServices>['conversationService'], id: string) {
  try {
    return await conversationService.getById(id)
  }
  catch {
    return null
  }
}
