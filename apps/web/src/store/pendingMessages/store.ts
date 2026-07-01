import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PendingMessage {
  id: string
  conversationId: string
  text: string
  createdAt: number
}

interface PendingMessagesState {
  itemsByConversation: Record<string, PendingMessage[]>
}

const pendingMessagesStorage = {
  getItem: (name: string) => {
    const raw = localStorage.getItem(name)
    if (!raw)
      return null

    try {
      const stored = JSON.parse(raw) as { state?: unknown, version?: number }
      if (!isPersistedState(stored?.state))
        throw new Error('待处理消息持久化结构无效')
      return stored as { state: { itemsByConversation: Record<string, PendingMessage[]> }, version: number }
    }
    catch (error) {
      console.warn('恢复待处理消息失败，已回退为空队列', error)
      return { state: { itemsByConversation: {} }, version: 1 }
    }
  },
  setItem: (name: string, value: unknown) => localStorage.setItem(name, JSON.stringify(value)),
  removeItem: (name: string) => localStorage.removeItem(name),
}

export const usePendingMessagesStore = create<PendingMessagesState>()(
  persist(
    () => ({
      itemsByConversation: {},
    }),
    {
      name: 'ant-chat:pending-messages:v1',
      version: 1,
      storage: pendingMessagesStorage,
      partialize: state => ({ itemsByConversation: state.itemsByConversation }),
    },
  ),
)

function isPersistedState(value: unknown): value is { itemsByConversation: Record<string, PendingMessage[]> } {
  if (!value || typeof value !== 'object' || !('itemsByConversation' in value))
    return false

  const itemsByConversation = (value as Record<string, unknown>).itemsByConversation
  if (!itemsByConversation || typeof itemsByConversation !== 'object' || Array.isArray(itemsByConversation))
    return false

  return Object.values(itemsByConversation as Record<string, unknown>).every(items =>
    Array.isArray(items) && items.every(isPendingMessage),
  )
}

function isPendingMessage(value: unknown): value is PendingMessage {
  if (!value || typeof value !== 'object')
    return false
  const item = value as Partial<PendingMessage>
  return typeof item.id === 'string'
    && typeof item.conversationId === 'string'
    && typeof item.text === 'string'
    && typeof item.createdAt === 'number'
}

export function sortPendingMessages(items: PendingMessage[]): PendingMessage[] {
  return [...items].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}
