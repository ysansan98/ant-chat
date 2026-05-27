import { useEffect, useEffectEvent, useImperativeHandle, useRef } from 'react'

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
  onWheel?: (e: React.WheelEvent) => void
  // 控制初始滚动位置。默认值: 当 direction='top' 时为 'bottom'
  // 设置为 'none' 可以禁止自动滚动，允许父组件自行控制位置
  initialScrollPosition?: 'bottom' | 'top' | 'none'
}

export interface ImperativeHandleRef {
  scrollToBottom: () => void
  containerRef: React.RefObject<HTMLElement | null>
  // 滚动到指定选择器的元素
  scrollToElement: (selector: string) => void
}

export const InfiniteScroll: React.FC<Props> = ({
  hasMore,
  loading,
  onLoadMore,
  onWheel,
  loadingComponent,
  noMoreComponent,
  children,
  threshold = 0.1,
  ref,
  direction = 'top', // 默认触顶加载
  className = '',
  initialScrollPosition,
  ...restProps
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const topObserverRef = useRef<HTMLDivElement>(null)
  const bottomObserverRef = useRef<HTMLDivElement>(null)
  const oldScrollHeightRef = useRef<number>(0)

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
    }
  }

  // 滚动到指定选择器的元素
  const scrollToElement = (selector: string) => {
    if (containerRef.current) {
      const element = containerRef.current.querySelector(selector)
      if (element) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }
    }
  }

  // 使用 useEffectEvent 包裹回调，访问最新的 props 和 state
  const onIntersect = useEffectEvent(async (entry: IntersectionObserverEntry) => {
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
  })

  useEffect(() => {
    const shouldObserveTop = direction === 'top' || direction === 'both'
    const shouldObserveBottom = direction === 'bottom' || direction === 'both'

    const observer = new IntersectionObserver(
      (entries) => {
        onIntersect(entries[0])
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
  }, [direction, threshold])

  useImperativeHandle(ref, () => ({
    containerRef,
    scrollToBottom,
    scrollToElement,
  }))

  const hasInitializedRef = useRef(false)

  // 初始滚动位置控制（仅在挂载时执行一次）
  useEffect(() => {
    if (hasInitializedRef.current)
      return
    hasInitializedRef.current = true

    if (initialScrollPosition === 'none')
      return

    const position = initialScrollPosition || (direction === 'top' ? 'bottom' : 'top')

    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = position === 'bottom' ? containerRef.current.scrollHeight : 0
      }
    })
  }, [initialScrollPosition, direction])

  return (
    <div
      ref={containerRef}
      className={`
        overflow-y-auto
        ${className}
      `}
      {...restProps}
      onWheel={onWheel}
    >
      {/* 触顶加载观察器 */}
      {(direction === 'top' || direction === 'both') && (
        <div ref={topObserverRef} className="h-1">
          {!hasMore && noMoreComponent}
        </div>
      )}

      {/* 加载指示器 - 根据方向显示在顶部或底部 */}
      {loading && (
        direction === 'top' || direction === 'both'
          ? (
              <div className="flex justify-center py-2">
                {loadingComponent}
              </div>
            )
          : null
      )}

      {children}

      {/* 加载指示器 - 底部方向时显示在底部 */}
      {loading && (direction === 'bottom' || direction === 'both')
        ? (
            <div className="flex justify-center py-2">
              {loadingComponent}
            </div>
          )
        : null}

      {/* 触底加载观察器 */}
      {(direction === 'bottom' || direction === 'both') && (
        <div ref={bottomObserverRef} className="h-1">
          {!hasMore && noMoreComponent}
        </div>
      )}
    </div>
  )
}
