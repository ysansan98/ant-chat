import type { ConversationRepository } from '@ant-chat/app-data'
import type { AddConversationsSchema, UpdateConversationsSchema } from '@ant-chat/shared'
import {
  addConversation,
  deleteConversation,
  getConversationById,
  getConversations,
  getConversationsTotal,
  updateConversation,
} from '@main/db/services'

export class SqliteConversationRepository implements ConversationRepository {
  async list(pageIndex: number, pageSize: number, workspacePath?: string, includeNullWorkspace = false) {
    const [data, total] = await Promise.all([
      getConversations(pageIndex, pageSize, workspacePath, includeNullWorkspace),
      getConversationsTotal(workspacePath, includeNullWorkspace),
    ])
    return { data, total }
  }

  async getById(id: string) {
    return getConversationById(id)
  }

  async create(conversation: AddConversationsSchema) {
    return addConversation(conversation)
  }

  async update(conversation: UpdateConversationsSchema) {
    return updateConversation(conversation)
  }

  async delete(id: string) {
    return deleteConversation(id)
  }
}
