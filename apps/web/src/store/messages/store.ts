import type { ConversationsId, IMessage } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface InitialState {
  activeConversationsId: ConversationsId
  messages: IMessage[]
}

const initialState: InitialState = {
  activeConversationsId: '' as ConversationsId,
  messages: [],
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
