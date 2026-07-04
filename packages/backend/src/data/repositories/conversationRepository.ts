import type { AddConversationsSchema, IConversations, UpdateConversationsSchema } from '@ant-chat/shared'

export interface PaginatedResult<T> {
  data: T[]
  total: number
}

export interface ArchivedWorkspaceCount {
  workspacePath: string
  total: number
}

export interface ConversationRepository {
  list: (pageIndex: number, pageSize: number, workspacePath?: string, includeNullWorkspace?: boolean) => Promise<PaginatedResult<IConversations>>
  listArchived: (pageIndex: number, pageSize: number, workspacePath: string, query?: string) => Promise<PaginatedResult<IConversations>>
  listArchivedWorkspaces: (query?: string) => Promise<ArchivedWorkspaceCount[]>
  getById: (id: string) => Promise<IConversations>
  create: (conversation: AddConversationsSchema) => Promise<IConversations>
  update: (conversation: UpdateConversationsSchema) => Promise<IConversations>
  setArchived: (id: string, archived: boolean) => Promise<IConversations>
  delete: (id: string) => Promise<boolean>
  deleteByWorkspace: (workspacePath?: string, includeNullWorkspace?: boolean) => Promise<string[]>
  deleteArchived: (id: string) => Promise<string[]>
  deleteArchivedByWorkspace: (workspacePath: string) => Promise<string[]>
  deleteAllArchived: () => Promise<string[]>
}
