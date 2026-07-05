import type { IConversations } from './db-types'

export interface ArchivedConversationWorkspace {
  workspacePath: string | null
  displayName: string
  total: number
  matchedTotal: number
  available: boolean
  conversations: IConversations[]
}

export interface ArchivedConversationWorkspaceResult {
  total: number
  workspaces: ArchivedConversationWorkspace[]
}
