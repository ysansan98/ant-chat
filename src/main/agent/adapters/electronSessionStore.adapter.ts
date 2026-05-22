import type { CreateAssistantMessageInput, CreateConversationInput, CreateUserMessageInput, ISessionStore, UpdateAssistantMessageInput, UpdateConversationInput } from '@ant-chat/shared'
import { addConversation, addMessage, createAIMessage, getConversationById, getConversations, getMessagesByConvId, updateConversation, updateMessage } from '@main/db/services'

export function createElectronSessionStore(): ISessionStore {
  return {
    async getConversation(id) {
      return await getNullableConversation(id)
    },
    async getConversationById(id) {
      return await getNullableConversation(id)
    },
    async createConversation(data: CreateConversationInput) {
      return await addConversation(data)
    },
    async updateConversation(id: string, patch: UpdateConversationInput) {
      return await updateConversation({ id, ...patch })
    },
    async listConversations() {
      return await getConversations(0, 1000)
    },
    async getMessages(convId) {
      return await getMessagesByConvId(convId)
    },
    async getMessagesByConvId(convId) {
      return await getMessagesByConvId(convId)
    },
    async createUserMessage(data: CreateUserMessageInput) {
      return await addMessage(data)
    },
    async createAssistantMessage(data: CreateAssistantMessageInput) {
      return await createAIMessage(data.conversationId, data.modelInfo)
    },
    async updateAssistantMessage(id: string, patch: UpdateAssistantMessageInput) {
      return await updateMessage({ id, ...patch })
    },
    async saveCompactionState(input) {
      const conv = await getConversationById(input.conversationId)
      await updateConversation({
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

async function getNullableConversation(id: string) {
  try {
    return await getConversationById(id)
  }
  catch {
    return null
  }
}
