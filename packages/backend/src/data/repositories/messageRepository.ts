import type { AddMessage, IMessage, UpdateMessageSchema } from '@ant-chat/shared'

export interface MessageRepository {
  listByConversation: (conversationId: string) => Promise<IMessage[]>
  getById: (id: string) => Promise<IMessage>
  create: (message: AddMessage & { createdAt?: number }, options?: { id?: string }) => Promise<IMessage>
  update: (message: UpdateMessageSchema) => Promise<IMessage>
  delete: (id: string) => Promise<boolean>
  batchDelete: (ids: string[]) => Promise<boolean>
  loadAttachmentData: (fileId: string) => Promise<string | null>
  loadVisualizationData: (input: { conversationId: string, messageId: string, fileId: string }) => Promise<string | null>
}
