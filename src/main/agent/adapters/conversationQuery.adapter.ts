import type { IConversationQuery, IMessage } from '@ant-chat/shared'
import { getConversationById, getMessagesByConvId } from '@main/db/services'

export function createDbConversationQuery(): IConversationQuery {
  return {
    getConversationById: async (id) => {
      return await getConversationById(id)
    },
    getMessagesByConvId: async (convId) => {
      return await getMessagesByConvId(convId) as IMessage[]
    },
  }
}
