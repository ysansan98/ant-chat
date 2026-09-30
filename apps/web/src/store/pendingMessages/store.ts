import type { AppPendingMessage, AppPendingMessageSnapshot } from '@ant-chat/shared'
import { create } from 'zustand'

/**
 * 待处理消息队列的客户端投影。
 *
 * 队列真相在后端 runtime；本 store 只保存每个会话最近一次快照，
 * 由 RPC 响应与 `agent:pending-messages-updated` 事件共同对账。
 * revision 用于丢弃乱序到达的旧快照（对账拉取除外）。
 */
interface PendingMessagesState {
  itemsByConversation: Record<string, AppPendingMessage[]>
  revisionByConversation: Record<string, number>
  applySnapshot: (snapshot: AppPendingMessageSnapshot, options?: { force?: boolean }) => void
  clearConversation: (conversationId: string) => void
}

export const usePendingMessagesStore = create<PendingMessagesState>((set, get) => ({
  itemsByConversation: {},
  revisionByConversation: {},
  applySnapshot: (snapshot, options) => {
    const { conversationId, revision, messages } = snapshot
    const known = get().revisionByConversation[conversationId]
    if (!options?.force && known !== undefined && revision < known)
      return
    set(state => ({
      itemsByConversation: { ...state.itemsByConversation, [conversationId]: messages },
      revisionByConversation: { ...state.revisionByConversation, [conversationId]: revision },
    }))
  },
  clearConversation: conversationId => set((state) => {
    const itemsByConversation = { ...state.itemsByConversation }
    const revisionByConversation = { ...state.revisionByConversation }
    delete itemsByConversation[conversationId]
    delete revisionByConversation[conversationId]
    return { itemsByConversation, revisionByConversation }
  }),
}))
