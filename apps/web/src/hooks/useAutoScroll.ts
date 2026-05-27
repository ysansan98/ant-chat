import type { ImperativeHandleRef } from '../components/InfiniteScroll'
import { useCallback, useEffect, useRef, useState } from 'react'

export function useAutoScroll() {
  const [autoScrollToBottom, setAutoScrollToBottom] = useState(true)
  const infiniteScrollRef = useRef<ImperativeHandleRef>(null)
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearScrollTimer = useCallback(() => {
    if (scrollEndTimerRef.current) {
      clearTimeout(scrollEndTimerRef.current)
      scrollEndTimerRef.current = null
    }
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < -1) {
      setAutoScrollToBottom(false)
      clearScrollTimer()
    }
    else if (e.deltaY > 1 && e.currentTarget) {
      const target = e.currentTarget as HTMLElement
      const isAtBottom = target.scrollHeight - Math.abs(target.scrollTop) - target.clientHeight <= 1
      if (isAtBottom) {
        clearScrollTimer()
        scrollEndTimerRef.current = setTimeout(() => {
          setAutoScrollToBottom(true)
        }, 150)
      }
    }
  }, [clearScrollTimer])

  const justClickedRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    clearScrollTimer()
    justClickedRef.current = true
    infiniteScrollRef.current?.scrollToBottom()
    setAutoScrollToBottom(true)
  }, [clearScrollTimer])

  // 每次 render 后若处于自动滚动模式，保持滚到底部
  // 跳过用户点击触发的本次 render，避免 effect 二次调用打断 smooth 动画
  useEffect(() => {
    if (autoScrollToBottom && !justClickedRef.current) {
      infiniteScrollRef.current?.scrollToBottom()
    }
    justClickedRef.current = false
  })

  return {
    autoScrollToBottom,
    infiniteScrollRef,
    handleWheel,
    scrollToBottom,
  }
}
