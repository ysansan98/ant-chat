import { useEffect, useImperativeHandle, useRef, useState } from 'react'

interface Props {
  // 是否还有更多数据
  hasMore: boolean
  // 加载状态
  loading: boolean
  // 加载更多的回调函数
  onLoadMore: () => Promise<void>
  // 加载提示组件
  loadingComponent?: React.ReactNode
  // 无更多数据提示组件
  noMoreComponent?: React.ReactNode
  // 容器类名
  className?: string
  // 子元素
  children: React.ReactNode
  // 观察器的阈值
  threshold?: number
  // 新增加载方向配置
  direction?: 'top' | 'bottom' | 'both'
  ref?: React.Ref<ImperativeHandleRef>
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
}

export interface ImperativeHandleRef {
  scrollToBottom: () => void
  containerRef: React.RefObject<HTMLElement | null>
}

export const InfiniteScroll: React.FC<Props> = ({
  hasMore,
  loading,
  onLoadMore,
  loadingComponent,
  noMoreComponent,
  children,
  threshold = 0.1,
  ref,
  direction = 'top', // 默认触顶加载
  className = '',
  ...restProps
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const topObserverRef = useRef<HTMLDivElement>(null)
  const bottomObserverRef = useRef<HTMLDivElement>(null)
  const [inited, setInited] = useState(false)
  const oldScrollHeightRef = useRef<number>(0)

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current?.lastElementChild?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      })
    }
  }

  useEffect(() => {
    if (!inited) {
      return
    }
    const shouldObserveTop = direction === 'top' || direction === 'both'
    const shouldObserveBottom = direction === 'bottom' || direction === 'both'

    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0]
        if (!entry.isIntersecting || loading || !hasMore)
          return

        if (containerRef.current) {
          oldScrollHeightRef.current = containerRef.current.scrollHeight
        }

        await onLoadMore()

        // 只在触顶加载时需要保持滚动位置
        if (entry.target === topObserverRef.current) {
          requestAnimationFrame(() => {
            if (containerRef.current) {
              const newScrollHeight = containerRef.current.scrollHeight
              const scrollDiff = newScrollHeight - oldScrollHeightRef.current
              containerRef.current.scrollTop = scrollDiff
            }
          })
        }
      },
      {
        root: containerRef.current,
        threshold,
      },
    )

    // 根据方向设置观察器
    if (shouldObserveTop && topObserverRef.current) {
      observer.observe(topObserverRef.current)
    }
    if (shouldObserveBottom && bottomObserverRef.current) {
      observer.observe(bottomObserverRef.current)
    }

    return () => observer.disconnect()
  }, [inited, hasMore])

  useImperativeHandle(ref, () => ({
    containerRef,
    scrollToBottom,
  }))

  useEffect(() => {
    if (direction === 'top') {
      containerRef.current?.lastElementChild?.scrollIntoView(false)
    }

    setInited(true)
  }, [])

  return (
    <div
      ref={containerRef}
      className={`
        overflow-y-auto
        ${className}
      `}
      {...restProps}
    >
      {/* 触顶加载观察器 */}
      {(direction === 'top' || direction === 'both') && inited && (
        <div ref={topObserverRef} className="h-1">
          {!hasMore && noMoreComponent}
        </div>
      )}

      {loading && loadingComponent}

      {children}

      {/* 触底加载观察器 */}
      {(direction === 'bottom' || direction === 'both') && (
        <div ref={bottomObserverRef} className="h-1">
          {!hasMore && noMoreComponent}
        </div>
      )}
      {/* 滚动到底部时，需要借助该元素 */}
      <div className="h-[1px]"></div>
    </div>
  )
}
