import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { sortPendingMessages, usePendingMessagesStore } from '@/store/pendingMessages'
import { PendingMessageItem } from './PendingMessageItem'

const EMPTY_ITEMS: never[] = []

interface PendingMessageQueueProps {
  conversationId: string
  canInject: boolean
  onInject: (id: string) => void
  onEdit: (id: string, text: string) => void
  onRemove: (id: string) => void
}

export function PendingMessageQueue(props: PendingMessageQueueProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const items = usePendingMessagesStore(state => state.itemsByConversation[props.conversationId] ?? EMPTY_ITEMS)
  const sortedItems = useMemo(() => sortPendingMessages(items), [items])
  const previousLength = useRef(sortedItems.length)

  useLayoutEffect(() => {
    if (viewportRef.current)
      viewportRef.current.scrollTop = 0
  }, [props.conversationId])

  useEffect(() => {
    const viewport = viewportRef.current
    const wasNearBottom = viewport
      ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32
      : false
    if (viewport && sortedItems.length > previousLength.current && wasNearBottom)
      viewport.scrollTop = viewport.scrollHeight
    previousLength.current = sortedItems.length
  }, [sortedItems.length])

  if (!sortedItems.length)
    return null

  return (
    <div>
      <div ref={viewportRef} aria-label="待处理消息" className="pending-message-scroll max-h-68 overflow-y-auto">
        {sortedItems.map(item => (
          <PendingMessageItem
            item={item}
            key={item.id}
            canInject={props.canInject}
            onInject={props.onInject}
            onEdit={props.onEdit}
            onRemove={props.onRemove}
          />
        ))}
      </div>
    </div>
  )
}
