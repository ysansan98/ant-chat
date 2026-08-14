import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

/** 折叠后最多保留的行数 */
const CLAMP_LINES = 6

const CLAMP_CLASSES = [`line-clamp-${CLAMP_LINES}`, 'overflow-hidden'] as const

interface CollapsibleMessageTextProps {
  children: ReactNode
}

/**
 * 长文本默认折叠：内容超过 CLAMP_LINES 行时裁剪展示，
 * 并提供「显示更多 / 收起」切换。内容不足阈值时不裁剪、不显示按钮。
 */
export function CollapsibleMessageText({ children }: CollapsibleMessageTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

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
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-0.5 self-start px-1.5 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded(prev => !prev)}
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
