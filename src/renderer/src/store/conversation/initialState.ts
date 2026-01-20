import type { IConversations } from '@ant-chat/shared'

export interface StoreState {
  conversations: IConversations[]
  abortCallbacks: (() => void)[]
  pageIndex: number
  pageSize: number
  conversationsTotal: number
  activeConversationsId: string
  streamingConversationIds: Set<string>
}

export const initialState: StoreState = {
  conversations: [],
  abortCallbacks: [],
  streamingConversationIds: new Set<string>(),
  pageIndex: 0,
  pageSize: 20,
  conversationsTotal: 1,
  activeConversationsId: '',
}
