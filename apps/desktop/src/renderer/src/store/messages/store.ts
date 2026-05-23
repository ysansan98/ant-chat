import type { ConversationsId, IMessage } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface InitialState {
  activeConversationsId: ConversationsId
  messages: IMessage[]
  pageIndex: number
  pageSize: number
  messageTotal: number
}

const initialState: InitialState = {
  activeConversationsId: '' as ConversationsId,
  messages: [],
  pageIndex: 0,
  pageSize: 6,
  messageTotal: 1,
}

type MessagesStore = InitialState & {
  reset: () => void
}

export const useMessagesStore = create<MessagesStore>()(
  devtools(
    set => ({
      ...initialState,
      reset: () => {
        set(initialState)
      },
    }),
    {
      enabled: import.meta.env.MODE === 'development',
    },
  ),
)
