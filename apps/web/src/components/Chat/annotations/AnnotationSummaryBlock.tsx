import { Button } from '@workspace/ui/components/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@workspace/ui/components/hover-card'
import { cn } from '@workspace/ui/lib/utils'
import { MessageSquarePlusIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'

/** 批注汇总项的通用数据形态：消息模式（已发送 annotation block）与草稿模式共用。 */
export interface AnnotationSummaryItemData {
  id: string
  quote: string
  comment: string
  /** 引用原文所在的 assistant 消息 id（编辑时滚动定位） */
  targetMessageId: string
}

interface AnnotationSummaryBlockProps {
  items: AnnotationSummaryItemData[]
  /** 编辑（仅发送前草稿）：调用方负责滚动到引用消息并打开草稿编辑浮层；缺省时列表只读 */
  onEdit?: (item: AnnotationSummaryItemData) => void
  /** 删除（仅发送前草稿）；缺省时列表只读 */
  onDelete?: (id: string) => void
}

/**
 * 批注汇总块（消息列表与 Sender 输入框上方共用）："n条注释"按钮，
 * hover 展开批注列表；列表项 hover 时右上角出现编辑/删除（icon 形式，删除无需二次确认）。
 * 数据与行为由调用方注入，展示形态完全一致。
 */
export function AnnotationSummaryBlock({ items, onEdit, onDelete }: AnnotationSummaryBlockProps) {
  const [open, setOpen] = useState(false)

  if (items.length === 0) {
    return null
  }

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger render={(
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-muted-foreground"
        >
          <MessageSquarePlusIcon className="size-3.5" />
          {items.length}
          条注释
        </Button>
      )}
      />
      <HoverCardContent align="end" className="w-80 p-1.5">
        {/* 批注较多时限制列表高度，内部滚动 */}
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {items.map((item, index) => (
            <AnnotationSummaryItem
              key={item.id}
              item={item}
              index={index}
              onEdit={onEdit
                ? (editedItem) => {
                    // 进入编辑态后收起列表，避免编辑浮层与列表重叠
                    setOpen(false)
                    onEdit(editedItem)
                  }
                : undefined}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  )
}

interface AnnotationSummaryItemProps {
  item: AnnotationSummaryItemData
  /** 序号（从 0 开始），列表内按添加顺序展示 */
  index: number
  onEdit?: (item: AnnotationSummaryItemData) => void
  onDelete?: (id: string) => void
}

/**
 * 批注列表项：引用/评论预览 + hover 时右上角出现编辑/删除（icon 形式）。
 * 操作按钮常驻 DOM（hover 控制可见性），保证键盘/屏幕阅读器可达。
 */
export function AnnotationSummaryItem({ item, index, onEdit, onDelete }: AnnotationSummaryItemProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <li
      className={cn(
        'group/item relative rounded-md p-2 transition-colors hover:bg-accent',
        // 仅可编辑时预留右侧操作按钮空间，只读模式内容区占满整行
        (onEdit || onDelete) && 'pr-8',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-px w-3.5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.quote}</p>
          {item.comment && (
            <p className="mt-0.5 line-clamp-2 text-sm">{item.comment}</p>
          )}
        </div>
      </div>
      {(onEdit || onDelete) && (
        <div
          className={cn(
            'absolute top-1 right-1 flex gap-0.5 transition-opacity',
            hovered ? 'opacity-100' : 'opacity-0',
          )}
        >
          {onEdit && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="编辑批注"
              onClick={() => onEdit(item)}
            >
              <PencilIcon className="size-3" />
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="删除批注"
              onClick={() => onDelete(item.id)}
            >
              <Trash2Icon className="size-3" />
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
