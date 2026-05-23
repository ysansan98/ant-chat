import type { AddMessage, IMessage, UpdateMessageSchema } from '@ant-chat/shared'
import type { MessageRepository, PaginatedResult } from '../repositories'

export class MessageService {
  constructor(private readonly repository: MessageRepository) {}

  async listByConversation(conversationId: string): Promise<IMessage[]> {
    return this.repository.listByConversation(conversationId)
  }

  async listByConversationPaginated(conversationId: string, pageIndex: number, pageSize: number): Promise<PaginatedResult<IMessage>> {
    return this.repository.listByConversationPaginated(conversationId, pageIndex, pageSize)
  }

  async getById(id: string): Promise<IMessage> {
    return this.repository.getById(id)
  }

  async create(message: AddMessage): Promise<IMessage> {
    return this.repository.create(message)
  }

  async update(message: UpdateMessageSchema): Promise<IMessage> {
    return this.repository.update(message)
  }

  async delete(id: string): Promise<boolean> {
    return this.repository.delete(id)
  }

  async batchDelete(ids: string[]): Promise<boolean> {
    return this.repository.batchDelete(ids)
  }
}
