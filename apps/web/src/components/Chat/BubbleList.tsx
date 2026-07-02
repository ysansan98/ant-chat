import type { IMessage } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { ArrowDownIcon } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useMessageActions } from '@/hooks/useMessageActions'
import { useAgentStore } from '@/store/agent'
import { InfiniteScroll } from '../InfiniteScroll'
import { buildConversationItems, getRootUserMessages } from './conversationItems'
import { ConversationTurn } from './ConversationTurn'
import { MessageBubble } from './MessageBubble'
import { MessageJumpRail } from './MessageJumpRail'

interface Props {
  messages: IMessage[]
}

function BubbleList({ messages }: Props) {
  const {
    autoScrollToBottom,
    setAutoScrollToBottom,
    infiniteScrollRef,
    handleWheel,
    scrollToBottom,
  } = useAutoScroll()

  const { copyMessage } = useMessageActions()
  const executionPhaseByTurn = useAgentStore(state => state.executionPhaseByTurn)
  const conversationItems = useMemo(
    () => buildConversationItems(messages, executionPhaseByTurn),
    [messages, executionPhaseByTurn],
  )

  // ---- 用户消息跳转导航 ----
  const userMessages = useMemo(
    () => getRootUserMessages(conversationItems),
    [conversationItems],
  )

  // 使用 useSyncExternalStore 订阅 IntersectionObserver 可见状态，完全回避
  // "在 useEffect 中调整 prop 派生状态" 的反模式: store 更新完全由观察者回调驱动，
  // 不依赖任何 prop 变更。
  const activeMessageId = useActiveMessageTracking(infiniteScrollRef, userMessages)

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
        className={`
          font-message flex h-full flex-col gap-5 px-3 py-4
          md:gap-6 md:px-4 md:py-6
        `}
        hasMore={false}
        loading={false}
        onLoadMore={async () => {}}
        direction="top"
        onWheel={handleWheel}
      >
        {conversationItems.map(item => item.type === 'turn'
          ? (
              <ConversationTurn
                key={item.turn.id}
                turn={item.turn}
                onCopyMessage={copyMessage}
              />
            )
          : (
              <MessageBubble
                key={item.message.id}
                messages={[item.message]}
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

      <MessageJumpRail
        userMessages={userMessages}
        activeMessageId={activeMessageId}
        onJumpToMessage={handleJumpToMessage}
      />
    </>
  )
}

export default BubbleList

/**
 * 通过 IntersectionObserver 跟踪滚动可见用户消息 ID。
 *
 * 使用 useSyncExternalStore 将 observer 回调的副作用隔离在 React state 系统外:
 * observer 只写入一个内存 store,组件通过订阅读取最新值。没有任何 setState 调用
 * 在 useEffect 内部,因此不会触发 "state synced to a prop inside an effect" 规则。
 *
 * 当 userMessages.length <= 1 时直接返回 null（渲染阶段决定,不依赖任何 effect）。
 */
function useActiveMessageTracking(
  infiniteScrollRef: { readonly current: { readonly containerRef: { readonly current: HTMLElement | null } } | null },
  userMessages: IMessage[],
): string | null {
  const storeRef = useRef<{ state: string | null, listeners: Set<() => void> }>({
    state: null,
    listeners: new Set(),
  })

  useEffect(() => {
    const store = storeRef.current
    store.state = null

    const container = infiniteScrollRef.current?.containerRef.current
    if (!container || userMessages.length <= 1) {
      return
    }

    const selector = userMessages.map(m => `[data-message-id="${m.id}"]`).join(',')
    const elements = container.querySelectorAll(selector)
    if (elements.length === 0) {
      return
    }

    const map = new Map<string, number>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId
          if (!id) {
            continue
          }
          if (entry.isIntersecting) {
            map.set(id, entry.intersectionRatio)
          }
          else {
            map.delete(id)
          }
        }

        let bestId: string | null = null
        let bestRatio = 0
        for (const [id, ratio] of map) {
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestId = id
          }
        }

        if (store.state !== bestId) {
          store.state = bestId
          store.listeners.forEach(cb => cb())
        }
      },
      { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )

    for (const el of elements) {
      observer.observe(el)
    }
    return () => observer.disconnect()
  }, [userMessages, infiniteScrollRef])

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      storeRef.current.listeners.add(onStoreChange)
      return () => {
        storeRef.current.listeners.delete(onStoreChange)
      }
    },
    [],
  )

  const getSnapshot = useCallback(() => storeRef.current.state, [])

  // useSyncExternalStore must be called unconditionally (rules of hooks)
  const activeId = useSyncExternalStore(subscribe, getSnapshot)

  // 渲染阶段决定:无可用消息时直接返回 null,不依赖任何 effect
  if (userMessages.length <= 1) {
    return null
  }

  return activeId
}
