import type { IMessage } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { ArrowDownIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Role } from '@/constants'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useMessageActions } from '@/hooks/useMessageActions'
import { usePagination } from '@/hooks/usePagination'
import { InfiniteScroll } from '../InfiniteScroll'
import Loading from '../Loading'
import { MessageBubble } from './MessageBubble'

interface Props {
  messages: IMessage[]
  conversationsId: string
  isAgentRunning: boolean
}

function BubbleList({ messages, conversationsId, isAgentRunning }: Props) {
  // 自动滚动逻辑
  const {
    autoScrollToBottom,
    infiniteScrollRef,
    handleWheel,
    scrollToBottom,
  } = useAutoScroll()

  // 分页逻辑
  const {
    isLoading,
    messageTotal,
    handleLoadMore,
  } = usePagination(conversationsId)

  // 消息操作逻辑
  const { copyMessage } = useMessageActions()

  const hasMore = messages.length < messageTotal
  const messageGroups = groupMessages(messages)

  // 当消息数量变化时自动滚动
  useEffect(() => {
    if (autoScrollToBottom) {
      scrollToBottom()
    }
  }, [messages.length, autoScrollToBottom, scrollToBottom])

  return (
    <InfiniteScroll
      ref={infiniteScrollRef}
      className="relative flex flex-col gap-6 px-4 py-6"
      hasMore={hasMore}
      loading={isLoading}
      onLoadMore={handleLoadMore}
      direction="top"
      loadingComponent={(
        <div className="flex justify-center py-2">
          <Loading />
        </div>
      )}
      onWheel={handleWheel}
    >
      {messageGroups.map(group => (
        <MessageBubble
          key={group.map(message => message.id).join(':')}
          messages={group}
          collapseIntermediate={!isAgentRunning}
          onCopyMessage={copyMessage}
        />
      ))}

      <Button
        size="icon-sm"
        variant="outline"
        className={`
          sticky bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background shadow-sm
          transition-opacity duration-300
          ${autoScrollToBottom
      ? `opacity-0`
      : `opacity-100`}
        `}
        type="button"
        onClick={scrollToBottom}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    </InfiniteScroll>
  )
}

export default BubbleList

function groupMessages(messages: IMessage[]): IMessage[][] {
  return messages.reduce<IMessage[][]>((groups, message) => {
    const lastGroup = groups.at(-1)
    const canMergeWithPrevious = message.role === Role.AI && lastGroup?.at(-1)?.role === Role.AI

    if (canMergeWithPrevious && lastGroup) {
      lastGroup.push(message)
    }
    else {
      groups.push([message])
    }

    return groups
  }, [])
}
