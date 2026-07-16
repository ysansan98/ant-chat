import type { PendingMessage } from './store'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { sortPendingMessages, usePendingMessagesStore } from './store'

let lastCreatedAt = 0

function updateConversationItems(conversationId: string, update: (items: PendingMessage[]) => PendingMessage[]): void {
  usePendingMessagesStore.setState(state => ({
    itemsByConversation: {
      ...state.itemsByConversation,
      [conversationId]: sortPendingMessages(update(state.itemsByConversation[conversationId] ?? [])),
    },
  }))
}

export function enqueuePendingMessage(conversationId: string, text: string): PendingMessage {
  return enqueuePendingMessageWithDelivery(conversationId, text, 'steering', 'sender')
}

export function enqueueVisualizationNextTurn(conversationId: string, text: string): PendingMessage {
  return enqueuePendingMessageWithDelivery(conversationId, text, 'next-turn', 'visualization')
}

function enqueuePendingMessageWithDelivery(
  conversationId: string,
  text: string,
  delivery: PendingMessage['delivery'],
  source: PendingMessage['source'],
): PendingMessage {
  const latestPersistedCreatedAt = Math.max(
    0,
    ...(usePendingMessagesStore.getState().itemsByConversation[conversationId] ?? []).map(item => item.createdAt),
  )
  const now = Math.max(Date.now(), lastCreatedAt + 1, latestPersistedCreatedAt + 1)
  lastCreatedAt = now
  const item: PendingMessage = { id: nanoid(), conversationId, text: text.trim(), createdAt: now, delivery, source }
  updateConversationItems(conversationId, items => [...items, item])
  return item
}

export function editPendingMessage(conversationId: string, id: string, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) {
    removePendingMessage(conversationId, id)
    toast.info('空消息已移除')
    return
  }
  updateConversationItems(conversationId, items => items.map(item => item.id === id ? { ...item, text: trimmed } : item))
}

export function removePendingMessage(conversationId: string, id: string): void {
  updateConversationItems(conversationId, items => items.filter(item => item.id !== id))
}

export function clearConversationPendingMessages(conversationId: string): void {
  usePendingMessagesStore.setState((state) => {
    const itemsByConversation = { ...state.itemsByConversation }
    delete itemsByConversation[conversationId]
    return { itemsByConversation }
  })
}

export function clearAllPendingMessages(): void {
  usePendingMessagesStore.setState({ itemsByConversation: {} })
}
