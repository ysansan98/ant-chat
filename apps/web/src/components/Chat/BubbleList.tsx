import type { IMessage } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { ArrowDownIcon, Loader2Icon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useMessageActions } from '@/hooks/useMessageActions'
import { InfiniteScroll } from '../InfiniteScroll'
import { MessageBubble } from './MessageBubble'
import { MessageJumpRail } from './MessageJumpRail'

interface Props {
  messages: IMessage[]
  conversationsId: string
  isCompacting?: boolean
}

function BubbleList({ messages, isCompacting = false }: Props) {
  const {
    autoScrollToBottom,
    setAutoScrollToBottom,
    infiniteScrollRef,
    handleWheel,
    scrollToBottom,
  } = useAutoScroll()

  const { copyMessage } = useMessageActions()

  const messageGroups = groupMessages(messages)

  // ---- 用户消息跳转导航 ----

  const userMessages = useMemo(
    () => messages.filter(m => m.role === 'user'),
    [messages],
  )

  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const visibilityMapRef = useRef<Map<string, number>>(new Map())

  // 使用 IntersectionObserver 跟踪各用户消息的可见比例
  useEffect(() => {
    const container = infiniteScrollRef.current?.containerRef.current
    if (!container || userMessages.length <= 1) {
      setActiveMessageId(null)
      return
    }

    const userMessageSelector = userMessages
      .map(m => `[data-message-id="${m.id}"]`)
      .join(',')

    const elements = container.querySelectorAll(userMessageSelector)
    if (elements.length === 0)
      return

    const map = visibilityMapRef.current
    map.clear()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId
          if (!id)
            continue
          if (entry.isIntersecting) {
            map.set(id, entry.intersectionRatio)
          }
          else {
            map.delete(id)
          }
        }

        // 选 intersection ratio 最高的作为 active
        let bestId: string | null = null
        let bestRatio = 0
        for (const [id, ratio] of map) {
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestId = id
          }
        }
        setActiveMessageId(bestId)
      },
      {
        root: container,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    )

    for (const el of elements) {
      observer.observe(el)
    }

    return () => observer.disconnect()
  }, [userMessages, infiniteScrollRef])

  const handleJumpToMessage = useCallback(
    (messageId: string) => {
      // 关闭自动滚动，防止跳转后被拉回底部
      setAutoScrollToBottom(false)

      const container = infiniteScrollRef.current?.containerRef.current
      if (!container)
        return
      const messageEl = container.querySelector(`[data-message-id="${messageId}"]`)
      if (!messageEl)
        return
      // 选中 MessageContent 内层 div（ai-elements/message.tsx:58），
      // 即带背景色/圆角的实际气泡容器，而非外层 wrapper
      const bubble = messageEl.querySelector('.flex.w-fit.min-w-0.max-w-full') as HTMLElement | null
      const target: HTMLElement = bubble || (messageEl as HTMLElement)

      // 手动计算容器内偏移量，只滚动 InfiniteScroll 容器，
      // 避免 scrollIntoView 触发窗口级别的滚动导致整个页面上移
      const scrollMargin = 24 // 1.5rem 呼吸空间
      const containerRect = container.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const offsetTop = targetRect.top - containerRect.top + container.scrollTop - scrollMargin

      container.scrollTo({
        top: Math.max(0, offsetTop),
        behavior: 'smooth',
      })

      // 高亮效果
      target.style.transition = 'box-shadow 0.3s ease-in-out'
      target.style.boxShadow = '0 0 0 2px var(--ring)'
      target.style.borderRadius = 'var(--radius-lg)'
      setTimeout(() => {
        target.style.boxShadow = ''
      }, 1500)
    },
    [infiniteScrollRef, setAutoScrollToBottom],
  )

  return (
    <>
      <InfiniteScroll
        ref={infiniteScrollRef}
        className="font-message flex flex-col gap-6 px-4 py-6"
        hasMore={false}
        loading={false}
        onLoadMore={async () => {}}
        direction="top"
        onWheel={handleWheel}
      >
        {messageGroups.map(group => (
          <MessageBubble
            key={group.map(message => message.id).join(':')}
            messages={group}
            onCopyMessage={copyMessage}
          />
        ))}

        {isCompacting && (
          <div className="mx-auto flex w-full max-w-(--chat-width) items-center gap-3 py-3">
            <div className="h-px flex-1 bg-border" />
            <span className="flex h-7 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              正在压缩上下文
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}

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

      <MessageJumpRail
        userMessages={userMessages}
        activeMessageId={activeMessageId}
        onJumpToMessage={handleJumpToMessage}
      />
    </>
  )
}

export default BubbleList

function groupMessages(messages: IMessage[]): IMessage[][] {
  return messages.reduce<IMessage[][]>((groups, message) => {
    // Event messages always start a new group so MessageBubble renders them as dividers
    if (message.role === 'event') {
      groups.push([message])
      return groups
    }

    const lastGroup = groups.at(-1)

    // Primary: group by turnId
    if (lastGroup && message.turnId && lastGroup.at(-1)?.turnId === message.turnId) {
      lastGroup.push(message)
      return groups
    }

    // Fallback: group consecutive non-user messages
    if (lastGroup && message.role !== 'user' && lastGroup.at(-1)?.role !== 'user') {
      lastGroup.push(message)
      return groups
    }

    groups.push([message])
    return groups
  }, [])
}
