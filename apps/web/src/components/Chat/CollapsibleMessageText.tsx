import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

/**
 * 折叠后最多保留的行数。
 *  注意：类名必须是字面量——Tailwind 只扫描源码里的完整候选类名，
 *  动态拼接的 line-clamp-6 不会生成对应样式。
 */
const CLAMP_CLASSES = ['line-clamp-6', 'overflow-hidden'] as const

interface CollapsibleMessageTextProps {
  children: ReactNode
}

/**
 * 长文本默认折叠：内容超过 CLAMP_LINES 行时裁剪展示，
 * 并提供「显示更多 / 收起」切换。内容不足阈值时不裁剪、不显示按钮。
 */
export function CollapsibleMessageText({ children }: CollapsibleMessageTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  // 收起锚点：点击「收起」时按钮相对视口顶部的距离。
  // 收起后内容变短，若视口不动，后续消息会被顶上来；
  // 恢复锚点让按钮留在原视口位置，视线不跳。
  const collapseAnchorRef = useRef<number | null>(null)
  const prevExpandedRef = useRef(expanded)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }

    // 折叠态下测量：scrollHeight 为完整内容高度，clientHeight 为裁剪后的可视高度。
    // 未折叠时临时加上裁剪类，避免内容不足时误判为溢出。
    const update = () => {
      const hadClamp = CLAMP_CLASSES.every(className => el.classList.contains(className))
      if (!hadClamp) {
        el.classList.add(...CLAMP_CLASSES)
      }
      const isOverflowing = el.scrollHeight > el.clientHeight
      if (!hadClamp) {
        el.classList.remove(...CLAMP_CLASSES)
      }
      setOverflowing(isOverflowing)
    }

    update()

    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 展开 → 收起 的布局稳定后（clamp 类已生效、高度已收缩）恢复锚点。
  useLayoutEffect(() => {
    if (prevExpandedRef.current && !expanded && collapseAnchorRef.current != null) {
      restoreAnchor(buttonRef.current, collapseAnchorRef.current)
    }
    prevExpandedRef.current = expanded
    collapseAnchorRef.current = null
  }, [expanded])

  const shouldClamp = !expanded && overflowing

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        ref={containerRef}
        className={cn('min-w-0', shouldClamp && CLAMP_CLASSES.join(' '))}
      >
        {children}
      </div>
      {overflowing && (
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-0.5 self-start px-0 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
          onClick={() => {
            // 收起前记录按钮的视口位置作为锚点
            if (expanded && buttonRef.current) {
              collapseAnchorRef.current = buttonRef.current.getBoundingClientRect().top
            }
            setExpanded(prev => !prev)
          }}
        >
          {expanded
            ? <ChevronUpIcon className="size-3.5" />
            : <ChevronDownIcon className="size-3.5" />}
          {expanded ? '收起' : '显示更多'}
        </Button>
      )}
    </div>
  )
}

/**
 * 找到最近的纵向可滚动祖先（不含自身），找不到时退回文档根。
 */
function getScrollableAncestor(el: HTMLElement): Element | null {
  let node: HTMLElement | null = el
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if (/auto|scroll|overlay/.test(overflowY) && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return document.scrollingElement
}

/**
 * 把滚动容器滚到让元素回到点击收起时记录的视口位置（锚点补偿）。
 * 注意：不能用增量补偿——收起瞬间浏览器已按收缩后的内容 clamp 过 scrollTop，
 * 增量基于 clamp 后的位置会算错；这里直接按按钮的文档坐标算出目标 scrollTop 赋值。
 */
function restoreAnchor(el: HTMLElement | null, anchorTop: number) {
  if (!el) {
    return
  }
  const scroller = getScrollableAncestor(el)
  if (!scroller) {
    return
  }
  // 按钮当前相对滚动容器内容原点的坐标（rect.top 为视口位置，scrollTop 为已滚距离）
  const buttonDocTop = el.getBoundingClientRect().top + scroller.scrollTop
  const targetScrollTop = buttonDocTop - anchorTop
  if (targetScrollTop === scroller.scrollTop) {
    return
  }
  scroller.scrollTop = targetScrollTop
}
