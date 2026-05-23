import type { AddConversationsSchema, IConversations, UpdateConversationsSchema } from '@ant-chat/shared'

export interface PaginatedResult<T> {
  data: T[]
  total: number
}

export interface ConversationRepository {
  list: (pageIndex: number, pageSize: number, workspacePath?: string, includeNullWorkspace?: boolean) => Promise<PaginatedResult<IConversations>>
  getById: (id: string) => Promise<IConversations>
  create: (conversation: AddConversationsSchema) => Promise<IConversations>
  update: (conversation: UpdateConversationsSchema) => Promise<IConversations>
  delete: (id: string) => Promise<boolean>
}
