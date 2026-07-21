import type { ImperativeHandleRef } from '../components/InfiniteScroll'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 距底部小于此值（px）视为"在底部"，补偿 sub-pixel 滚动和容器 padding */
const BOTTOM_THRESHOLD = 20

export function useAutoScroll() {
  const [autoScrollToBottom, setAutoScrollToBottom] = useState(true)
  const infiniteScrollRef = useRef<ImperativeHandleRef>(null)

  /**
   * 同步标记用户是否在底部。
   *
   * scroll 事件同步写入，供 useLayoutEffect 在 React state 异步生效前读取。
   * 流式输出渲染频繁，若用 state 判断，scroll 事件与 React 渲染之间存在时序窗口：
   * 用户已向上滚动但 state 尚未更新，useLayoutEffect 会读到旧值强制拉回底部。
   * 用 ref 绕过 React 调度，保证判断与滚动事件同源同步。
   */
  const isAtBottomRef = useRef(true)

  /**
   * 用户主动触发的 smooth 滚动期间为 true。
   *
   * 阻止两类打断：
   * 1) useLayoutEffect 的即时 'auto' 滚动覆盖 smooth 动画
   * 2) scroll 事件误判 smooth 过渡中的位置变化为"用户离开底部"
   */
  const isUserScrollingRef = useRef(false)

  /**
   * 关闭自动滚动并同步更新 ref。
   *
   * ref 必须同步写入：跳转消息后紧随的 useLayoutEffect 会读取 ref 决定是否强制滚动，
   * 若 ref 仍为旧值（true），会打断跳转把视图拉回底部。
   */
  const disableAutoScroll = useCallback(() => {
    isAtBottomRef.current = false
    setAutoScrollToBottom(false)
  }, [])

  /**
   * 用 scroll 事件统一判断用户是否在底部，覆盖所有滚动来源：
   * 鼠标滚轮、触摸板、触摸手势、键盘（PageDown/End/方向键）、程序滚动。
   * 替代原先的 wheel + touch 双监听，消除逻辑重复和触底阈值不一致。
   *
   * 只在 atBottom 状态翻转时 setState，避免高频 scroll 事件触发重渲染。
   */
  useEffect(() => {
    const container = infiniteScrollRef.current?.containerRef.current
    if (!container)
      return

    const onScroll = () => {
      if (isUserScrollingRef.current)
        return
      const diff = container.scrollHeight - container.scrollTop - container.clientHeight
      const atBottom = diff <= BOTTOM_THRESHOLD
      if (isAtBottomRef.current !== atBottom) {
        isAtBottomRef.current = atBottom
        setAutoScrollToBottom(atBottom)
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [])

  /**
   * 流式输出、tool 面板展开等持续改变内容高度时，必须在 paint 前即时锚定底部。
   *
   * 若改用 useEffect（paint 后），内容增高后浏览器先 paint 再滚动，
   * 用户会看到一帧"离开底部"的闪烁，且多次 smooth 动画相互打断表现为大幅补滚。
   * useLayoutEffect 在 DOM 变更后、paint 前同步执行，消除闪烁。
   *
   * 读取 isAtBottomRef（同步）而非 autoScrollToBottom（state），
   * 避免 scroll 事件与 React 渲染调度之间的时序窗口导致误判。
   */
  useLayoutEffect(() => {
    if (!isAtBottomRef.current || isUserScrollingRef.current)
      return
    infiniteScrollRef.current?.scrollToBottom('auto')
  })

  /**
   * 补充 useLayoutEffect 无法捕获的场景：非 React 渲染触发的高度变化
   * （图片懒加载完成、异步渲染的 markdown、代码块高亮等）。
   *
   * 依赖 autoScrollToBottom，状态切换时才重建 observer，而非每次渲染。
   * 回调内复用 isAtBottomRef，与 scroll 事件保持单一判断来源。
   */
  useEffect(() => {
    if (!autoScrollToBottom)
      return

    const container = infiniteScrollRef.current?.containerRef.current
    if (!container || typeof ResizeObserver === 'undefined')
      return

    const observer = new ResizeObserver(() => {
      if (isUserScrollingRef.current || !isAtBottomRef.current)
        return
      container.scrollTop = container.scrollHeight
    })
    for (const child of container.children)
      observer.observe(child)
    return () => observer.disconnect()
  }, [autoScrollToBottom])

  /**
   * 用户主动点击"回到底部"按钮：smooth 滚动，期间不被打断。
   *
   * 用 scrollend 事件清除标志（比原先"下次渲染即清除"的 justClickedRef 更健壮，
   * 覆盖整个 smooth 动画期间而非仅首次渲染），定时器兜底兼容不支持 scrollend 的环境。
   */
  const scrollToBottom = useCallback(() => {
    isAtBottomRef.current = true
    setAutoScrollToBottom(true)
    isUserScrollingRef.current = true
    infiniteScrollRef.current?.scrollToBottom('smooth')

    const container = infiniteScrollRef.current?.containerRef.current
    if (!container)
      return

    // 先声明再赋值，避免 cleanup 在 fallback 赋值前引用触发 TDZ
    let fallback: ReturnType<typeof setTimeout>
    const cleanup = () => {
      isUserScrollingRef.current = false
      container.removeEventListener('scrollend', cleanup)
      clearTimeout(fallback)
    }
    fallback = setTimeout(cleanup, 800)
    container.addEventListener('scrollend', cleanup)
  }, [])

  return {
    autoScrollToBottom,
    disableAutoScroll,
    infiniteScrollRef,
    scrollToBottom,
  }
}
