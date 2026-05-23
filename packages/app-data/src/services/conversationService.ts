import type { AddConversationsSchema, IConversations, UpdateConversationsSchema } from '@ant-chat/shared'
import type { ConversationRepository, PaginatedResult } from '../repositories'

export class ConversationService {
  constructor(private readonly repository: ConversationRepository) {}

  async list(pageIndex: number, pageSize: number, workspacePath?: string, includeNullWorkspace?: boolean): Promise<PaginatedResult<IConversations>> {
    return this.repository.list(pageIndex, pageSize, workspacePath, includeNullWorkspace)
  }

  async getById(id: string): Promise<IConversations> {
    return this.repository.getById(id)
  }

  async create(conversation: AddConversationsSchema): Promise<IConversations> {
    return this.repository.create(conversation)
  }

  async update(conversation: UpdateConversationsSchema): Promise<IConversations> {
    return this.repository.update(conversation)
  }

  async delete(id: string): Promise<boolean> {
    return this.repository.delete(id)
  }
}
