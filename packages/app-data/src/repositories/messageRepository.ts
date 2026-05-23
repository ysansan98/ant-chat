import type { AddMessage, IMessage, UpdateMessageSchema } from '@ant-chat/shared'
import type { PaginatedResult } from './conversationRepository'

export interface MessageRepository {
  listByConversation: (conversationId: string) => Promise<IMessage[]>
  listByConversationPaginated: (conversationId: string, pageIndex: number, pageSize: number) => Promise<PaginatedResult<IMessage>>
  getById: (id: string) => Promise<IMessage>
  create: (message: AddMessage) => Promise<IMessage>
  update: (message: UpdateMessageSchema) => Promise<IMessage>
  delete: (id: string) => Promise<boolean>
  batchDelete: (ids: string[]) => Promise<boolean>
}
