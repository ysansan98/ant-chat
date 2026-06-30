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
      const target = e.currentTarget as HTMLElement
      if (target.scrollHeight > target.clientHeight) {
        setAutoScrollToBottom(false)
        clearScrollTimer()
      }
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
    infiniteScrollRef.current?.scrollToBottom('smooth')
    setAutoScrollToBottom(true)
  }, [clearScrollTimer])

  // 增量内容和 tool 面板会连续改变高度。自动追随必须即时锚定底部，
  // 否则多次 smooth 动画会相互打断，表现为大幅补滚和闪烁。
  useEffect(() => {
    if (autoScrollToBottom && !justClickedRef.current) {
      infiniteScrollRef.current?.scrollToBottom('auto')
    }
    justClickedRef.current = false
  })

  useEffect(() => {
    if (!autoScrollToBottom)
      return

    const container = infiniteScrollRef.current?.containerRef.current
    if (!container || typeof ResizeObserver === 'undefined')
      return

    const observer = new ResizeObserver(() => {
      infiniteScrollRef.current?.scrollToBottom('auto')
    })
    for (const child of container.children) {
      observer.observe(child)
    }

    return () => observer.disconnect()
  })

  return {
    autoScrollToBottom,
    setAutoScrollToBottom,
    infiniteScrollRef,
    handleWheel,
    scrollToBottom,
  }
}
