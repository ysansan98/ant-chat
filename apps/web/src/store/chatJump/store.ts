import { create } from 'zustand'

/**
 * 消息列表跳转请求：批注编辑等场景需要滚动到指定消息时写入，
 * BubbleList 消费后执行滚动定位并清除。
 */
interface ChatJumpState {
  messageId: string | null
  jump: (messageId: string) => void
  consume: () => void
}

export const useChatJumpStore = create<ChatJumpState>()(
  set => ({
    messageId: null,
    jump: (messageId) => {
      set({ messageId })
    },
    consume: () => {
      set({ messageId: null })
    },
  }),
)
