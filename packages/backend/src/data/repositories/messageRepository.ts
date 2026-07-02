import type { AddMessage, IMessage, UpdateMessageSchema } from '@ant-chat/shared'

export interface MessageRepository {
  listByConversation: (conversationId: string) => Promise<IMessage[]>
  getById: (id: string) => Promise<IMessage>
  create: (message: AddMessage, options?: { id?: string }) => Promise<IMessage>
  update: (message: UpdateMessageSchema) => Promise<IMessage>
  delete: (id: string) => Promise<boolean>
  batchDelete: (ids: string[]) => Promise<boolean>
}
