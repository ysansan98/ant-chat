import type { useAutoScroll } from '../useAutoScroll'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoScroll as useAutoScrollFn } from '../useAutoScroll'

type AutoScrollResult = ReturnType<typeof useAutoScroll>

/**
 * useAutoScroll 依赖 infiniteScrollRef.current.containerRef.current 指向真实 DOM 容器。
 * 纯 renderHook 无法挂载 DOM，这里用测试专用组件挂载 ref 并暴露 hook 结果。
 *
 * spy 必须在 setup 作用域创建并跨 rerender 保持稳定：
 * 若在每次渲染中新建 vi.fn()，rerender 后 hook 内部读取的 spy 已被替换，
 * 断言会读到错误的 mock 实例。
 */
function setup() {
  const scrollToBottomSpy = vi.fn()
  const scrollToElementSpy = vi.fn()
  const results = { current: null as AutoScrollResult | null } as {
    current: AutoScrollResult | null
  }

  function TestComponent({ trigger }: { trigger: number }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const hook = useAutoScrollFn()
    results.current = hook
    // 同步注入 imperative handle，让 hook 内部 effect 能读到容器
    // spy 在 setup 作用域创建，跨 rerender 保持同一实例
    hook.infiniteScrollRef.current = {
      containerRef,
      scrollToBottom: scrollToBottomSpy,
      scrollToElement: scrollToElementSpy,
    }
    return (
      <div ref={containerRef}>
        <div style={{ height: 100 }}>top</div>
        <div style={{ height: `${trigger * 100}px` }}>growing</div>
        <div style={{ height: 10 }}>bottom</div>
      </div>
    )
  }

  const view = render(<TestComponent trigger={1} />)
  return { view, results, TestComponent, scrollToBottomSpy }
}

describe('useAutoScroll', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('初始状态开启自动滚动', () => {
    const { results } = setup()
    expect(results.current?.autoScrollToBottom).toBe(true)
  })

  it('disableAutoScroll 关闭自动滚动', () => {
    const { results } = setup()
    act(() => {
      results.current!.disableAutoScroll()
    })
    expect(results.current?.autoScrollToBottom).toBe(false)
  })

  it('disableAutoScroll 后新增内容不再触发 scrollToBottom', () => {
    const { results, view, TestComponent, scrollToBottomSpy } = setup()

    act(() => {
      results.current!.disableAutoScroll()
    })
    scrollToBottomSpy.mockClear()

    // 模拟流式新增内容触发 rerender
    view.rerender(<TestComponent trigger={2} />)

    expect(scrollToBottomSpy).not.toHaveBeenCalled()
  })

  it('在底部时新增内容触发 scrollToBottom("auto")', () => {
    const { view, TestComponent, scrollToBottomSpy } = setup()

    // 初始 autoScrollToBottom=true，首次 useLayoutEffect 会调用一次
    scrollToBottomSpy.mockClear()

    view.rerender(<TestComponent trigger={2} />)
    expect(scrollToBottomSpy).toHaveBeenCalledWith('auto')
  })

  it('scrollToBottom 用 smooth 行为恢复自动滚动', () => {
    const { results, scrollToBottomSpy } = setup()

    act(() => {
      results.current!.disableAutoScroll()
    })
    scrollToBottomSpy.mockClear()

    act(() => {
      results.current!.scrollToBottom()
    })

    expect(scrollToBottomSpy).toHaveBeenCalledWith('smooth')
    expect(results.current?.autoScrollToBottom).toBe(true)
  })

  it('用户向上滚动关闭自动滚动', () => {
    const { results } = setup()
    const container = results.current!.infiniteScrollRef.current!.containerRef.current!

    // 模拟用户向上滚动离开底部
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true })

    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })

    expect(results.current?.autoScrollToBottom).toBe(false)
  })

  it('用户滚回底部重新开启自动滚动', () => {
    const { results } = setup()
    const container = results.current!.infiniteScrollRef.current!.containerRef.current!

    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true })

    // 先向上滚离开底部
    Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true })
    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })
    expect(results.current?.autoScrollToBottom).toBe(false)

    // 再滚回底部（scrollTop 接近 scrollHeight - clientHeight）
    Object.defineProperty(container, 'scrollTop', { value: 590, configurable: true })
    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })
    expect(results.current?.autoScrollToBottom).toBe(true)
  })
})
