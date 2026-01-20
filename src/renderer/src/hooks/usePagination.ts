import type { ConversationsId } from '@ant-chat/shared'
import { useCallback, useState } from 'react'
import { nextPageMessagesAction, useMessagesStore } from '@/store/messages'

export function usePagination(conversationsId: string) {
  const [isLoading, setIsLoading] = useState(false)
  const messageTotal = useMessagesStore(state => state.messageTotal)

  const handleLoadMore = useCallback(async () => {
    setIsLoading(true)
    try {
      await nextPageMessagesAction(conversationsId as ConversationsId)
    }
    finally {
      setIsLoading(false)
    }
  }, [conversationsId])

  return {
    isLoading,
    messageTotal,
    handleLoadMore,
  }
}
