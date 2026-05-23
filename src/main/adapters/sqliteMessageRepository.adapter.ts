import type { MessageRepository } from '@ant-chat/app-data'
import type { AddMessage, UpdateMessageSchema } from '@ant-chat/shared'
import {
  addMessage,
  batchDeleteMessages,
  deleteMessage,
  getMessageById,
  getMessagesByConvId,
  getMessagesByConvIdWithPagination,
  updateMessage,
} from '@main/db/services'

export class SqliteMessageRepository implements MessageRepository {
  async listByConversation(conversationId: string) {
    return getMessagesByConvId(conversationId)
  }

  async listByConversationPaginated(conversationId: string, pageIndex: number, pageSize: number) {
    return getMessagesByConvIdWithPagination(conversationId, pageIndex, pageSize)
  }

  async getById(id: string) {
    return getMessageById(id)
  }

  async create(message: AddMessage) {
    return addMessage(message)
  }

  async update(message: UpdateMessageSchema) {
    return updateMessage(message)
  }

  async delete(id: string) {
    return deleteMessage(id)
  }

  async batchDelete(ids: string[]) {
    return batchDeleteMessages(ids)
  }
}
