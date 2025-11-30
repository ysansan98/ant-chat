import type { IMessage, MessageId } from '@ant-chat/shared'
import { ArrowDownOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useEffect } from 'react'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useMessageActions } from '@/hooks/useMessageActions'
import { usePagination } from '@/hooks/usePagination'
import { InfiniteScroll } from '../InfiniteScroll'
import Loading from '../Loading'
import { MessageBubble } from './MessageBubble'

interface Props {
  messages: IMessage[]
  conversationsId: string
  onRefresh?: (message: IMessage) => void
  onExecuteAllCompleted?: (messageId: MessageId) => void
}

function BubbleList({ messages, conversationsId, onExecuteAllCompleted, onRefresh }: Props) {
  // 自动滚动逻辑
  const {
    autoScrollToBottom,
    infiniteScrollRef,
    handleScroll,
    scrollToBottom,
  } = useAutoScroll()

  // 分页逻辑
  const {
    isLoading,
    messageTotal,
    handleLoadMore,
  } = usePagination(conversationsId)

  // 消息操作逻辑
  const { copyMessage, deleteMessage } = useMessageActions()

  const hasMore = messages.length < messageTotal

  // 处理底部按钮点击
  async function handleFooterButtonClick(buttonName: string, message: IMessage) {
    const mapping = {
      copy: () => copyMessage(message),
      refresh: () => onRefresh?.(message),
      delete: () => deleteMessage(message.id),
    }
    mapping[buttonName as keyof typeof mapping]?.()
  }

  // 当消息数量变化时自动滚动
  useEffect(() => {
    if (autoScrollToBottom) {
      scrollToBottom()
    }
  }, [messages.length, autoScrollToBottom, scrollToBottom])

  return (
    <InfiniteScroll
      ref={infiniteScrollRef}
      className="relative flex flex-col gap-4 px-4"
      hasMore={hasMore}
      loading={isLoading}
      onLoadMore={handleLoadMore}
      direction="top"
      loadingComponent={(
        <div className="flex justify-center py-2">
          <Loading />
        </div>
      )}
      onScroll={handleScroll}
    >
      {messages.map(message => (
        <MessageBubble
          key={message.id}
          message={message}
          onFooterButtonClick={handleFooterButtonClick}
          onExecuteAllCompleted={onExecuteAllCompleted}
        />
      ))}

      <Button
        size="small"
        className={`
          sticky! bottom-8 left-1/2 block min-h-6 w-6 -translate-x-1/2 transition-opacity
          duration-300
          ${autoScrollToBottom
      ? `opacity-0`
      : `opacity-100`}
        `}
        shape="circle"
        icon={<ArrowDownOutlined />}
        onClick={scrollToBottom}
      />
    </InfiniteScroll>
  )
}

export default BubbleList
