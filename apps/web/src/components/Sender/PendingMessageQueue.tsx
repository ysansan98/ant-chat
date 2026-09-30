import type { AppPendingMessage } from '@ant-chat/shared'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePendingMessagesStore } from '@/store/pendingMessages'
import { PendingMessageItem } from './PendingMessageItem'

const EMPTY_ITEMS: AppPendingMessage[] = []

interface PendingMessageQueueProps {
  conversationId: string
  canSteer: boolean
  onSteer: (id: string) => void
  onEdit: (id: string, text: string) => void
  onRemove: (id: string) => void
}

export function PendingMessageQueue(props: PendingMessageQueueProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const items = usePendingMessagesStore(state => state.itemsByConversation[props.conversationId] ?? EMPTY_ITEMS)
  const previousLength = useRef(items.length)

  useLayoutEffect(() => {
    if (viewportRef.current)
      viewportRef.current.scrollTop = 0
  }, [props.conversationId])

  useEffect(() => {
    const viewport = viewportRef.current
    const wasNearBottom = viewport
      ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32
      : false
    if (viewport && items.length > previousLength.current && wasNearBottom)
      viewport.scrollTop = viewport.scrollHeight
    previousLength.current = items.length
  }, [items.length])

  if (!items.length)
    return null

  return (
    <div>
      <div ref={viewportRef} aria-label="待处理消息" className="pending-message-scroll max-h-68 overflow-y-auto">
        {items.map(item => (
          <PendingMessageItem
            item={item}
            key={item.id}
            canSteer={props.canSteer}
            onSteer={props.onSteer}
            onEdit={props.onEdit}
            onRemove={props.onRemove}
          />
        ))}
      </div>
    </div>
  )
}
