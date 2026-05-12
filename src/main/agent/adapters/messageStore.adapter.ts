import type { IMessage, IMessageStore, MessageUpdatePatch } from '@ant-chat/shared'
import { createAIMessage, addMessage as dbAddMessage, updateMessage as dbUpdateMessage, getConversationById, getMessagesByConvId, updateConversation } from '@main/db/services'

export function createDbMessageStore(): IMessageStore {
  return {
    createAssistantMessage: async (convId, provider, providerId, model) => {
      const msg = await createAIMessage(convId, { provider, providerId, model })
      return { id: msg.id }
    },
    updateMessage: async (messageId, patch: MessageUpdatePatch) => {
      const msg = await dbUpdateMessage({ id: messageId, role: 'assistant', ...patch } as any)
      return { id: msg.id }
    },
    addMessage: async (params) => {
      const msg = await dbAddMessage({ ...params, images: [], attachments: [] } as any)
      return { id: msg.id }
    },
    getMessagesByConvId: async (convId) => {
      return await getMessagesByConvId(convId) as IMessage[]
    },
    getConversationById: async (id) => {
      return await getConversationById(id)
    },
    updateConversation: async (id, data) => {
      await updateConversation({ id, ...data } as any)
    },
  }
}
