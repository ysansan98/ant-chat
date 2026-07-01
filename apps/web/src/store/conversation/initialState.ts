import type { IConversations } from '@ant-chat/shared'

export interface WorkspaceConversationsState {
  conversations: IConversations[]
  pageIndex: number
  conversationsTotal: number
  loadVersion: number
  loaded: boolean
}

export interface StoreState {
  conversations: IConversations[]
  abortCallbacks: (() => void)[]
  pageIndex: number
  pageSize: number
  conversationsTotal: number
  activeConversationsId: string
  activeWorkspacePath: string
  streamingConversationIds: Set<string>
  completedConversationIds: Set<string>
  loadVersion: number
  workspaceConversations: Record<string, WorkspaceConversationsState>
}

export function createWorkspaceConversationsState(): WorkspaceConversationsState {
  return {
    conversations: [],
    pageIndex: 0,
    conversationsTotal: 1,
    loadVersion: 0,
    loaded: false,
  }
}

export function createInitialState(): StoreState {
  return {
    conversations: [],
    abortCallbacks: [],
    streamingConversationIds: new Set<string>(),
    completedConversationIds: new Set<string>(),
    pageIndex: 0,
    pageSize: 20,
    conversationsTotal: 1,
    activeConversationsId: '',
    activeWorkspacePath: '',
    loadVersion: 0,
    workspaceConversations: {},
  }
}

export const initialState: StoreState = createInitialState()
