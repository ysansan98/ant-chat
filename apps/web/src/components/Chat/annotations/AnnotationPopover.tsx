import type { CSSProperties } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Textarea } from '@workspace/ui/components/textarea'
import { cn } from '@workspace/ui/lib/utils'
import { useEffect, useRef, useState } from 'react'

interface AnnotationPopoverProps {
  /** 创建模式：仅输入框，Enter 保存；编辑模式：输入框 + 保存/删除 */
  mode: 'create' | 'edit'
  initialComment: string
  /** fixed 锚点（viewport 坐标）；不翻转时 y 是弹窗底边，翻转后是顶边 */
  x: number
  y: number
  /** 选区上方空间不足时翻转到下方 */
  flip: boolean
  onSave: (comment: string) => void
  onDelete?: () => void
  onCancel: () => void
}

const POPOVER_WIDTH = 288

function clampX(x: number): number {
  return Math.max(8, Math.min(x, window.innerWidth - POPOVER_WIDTH - 8))
}

/**
 * 批注输入浮层：创建模式只有一个单行输入框（Enter 保存、Shift+Enter 换行自动撑高），
 * 引用内容由选区高亮呈现，不在浮层内重复展示；编辑模式额外提供保存/删除按钮。
 */
export function AnnotationPopover({
  mode,
  initialComment,
  x,
  y,
  flip,
  onSave,
  onDelete,
  onCancel,
}: AnnotationPopoverProps) {
  const [comment, setComment] = useState(initialComment)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 打开即聚焦输入框：用户无需点击输入框，避免点击导致选区丢失后看不到选中内容；
  // 选中内容由 mark 高亮呈现，不依赖浏览器原生选区
  useEffect(() => {
    // 延迟到事件序列结束后再聚焦：mousedown 的浏览器默认行为（聚焦被点击元素）
    // 可能晚于渲染发生，立即 focus 会被其覆盖
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 输入法合成期间（候选窗/拼音确认）的 Escape 属于输入法操作，不关闭浮层
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div
      role="dialog"
      aria-label={mode === 'edit' ? '编辑批注' : '添加批注'}
      className={cn(
        // 容器即输入框的壳：无内边距、输入框去边框，避免双层边框的堆叠感
        'fixed z-50 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-md',
        'left-(--annotation-x)',
        flip ? 'top-(--annotation-y)' : 'bottom-(--annotation-y)',
      )}
      style={{
        '--annotation-x': `${clampX(x)}px`,
        // 不翻转时 y 是弹窗底边锚点，bottom 需要换算为距视口底部的距离
        '--annotation-y': `${flip ? y : window.innerHeight - y}px`,
      } as CSSProperties}
    >
      <div className="flex flex-col gap-2">
        <Textarea
          ref={textareaRef}
          autoFocus
          value={comment}
          onChange={event => setComment(event.target.value)}
          onKeyDown={(event) => {
            // Enter 保存、Shift+Enter 换行（textarea 默认行为，field-sizing 自动撑高）。
            // 输入法合成期间的 Enter 用于确认拼音/候选，不触发保存：isComposing 为标准属性，
            // keyCode 229 兜底旧浏览器。
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault()
              onSave(comment)
            }
          }}
          placeholder="写下你的评论…"
          aria-label="评论内容"
          className="min-h-0 resize-none rounded-none border-none bg-transparent px-2.5 py-1.5 shadow-none focus-visible:border-none focus-visible:ring-0 dark:bg-transparent"
        />
        {mode === 'edit' && (
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              删除
            </Button>
            <Button type="button" size="sm" onClick={() => onSave(comment)}>
              保存
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
