import type { ImperativeHandleRef } from '../components/InfiniteScroll'
import { useCallback, useEffect, useRef, useState } from 'react'

export function useAutoScroll() {
  const [autoScrollToBottom, setAutoScrollToBottom] = useState(true)
  const infiniteScrollRef = useRef<ImperativeHandleRef>(null)

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // 向上滚动时禁用自动滚动（忽略微小滚动）
    if (e.deltaY < -1) {
      setAutoScrollToBottom(false)
    }
    else if (e.deltaY > 1 && e.currentTarget) {
      // 向下滚动时，检查是否已经到达底部
      const target = e.currentTarget as HTMLElement
      const isAtBottom = target.scrollHeight - Math.abs(target.scrollTop) - target.clientHeight <= 1
      if (isAtBottom) {
        setAutoScrollToBottom(true)
      }
    }
  }, [])

  const scrollToEnd = useCallback(() => {
    infiniteScrollRef.current?.scrollToBottom()
  }, [])

  const scrollToBottom = useCallback(() => {
    scrollToEnd()
    // 点击滚动到底部时，恢复自动滚动状态
    setAutoScrollToBottom(true)
  }, [scrollToEnd])

  // 自动滚动到最底部
  useEffect(() => {
    if (autoScrollToBottom) {
      scrollToEnd()
    }
  })

  return {
    autoScrollToBottom,
    infiniteScrollRef,
    handleWheel,
    scrollToBottom,
  }
}
