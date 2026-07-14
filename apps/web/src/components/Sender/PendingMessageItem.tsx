import type { PendingMessage } from '@/store/pendingMessages'
import { Button } from '@workspace/ui/components/button'
import { Textarea } from '@workspace/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { CornerDownLeftIcon, GripVerticalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'

interface PendingMessageItemProps {
  item: PendingMessage
  canInject: boolean
  onInject: (id: string) => void
  onEdit: (id: string, text: string) => void
  onRemove: (id: string) => void
}

export function PendingMessageItem({ item, canInject, onInject, onEdit, onRemove }: PendingMessageItemProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)

  function save() {
    onEdit(item.id, draft)
    setEditing(false)
  }

  return (
    <div className="pending-message-enter flex items-center gap-1 p-2">
      <GripVerticalIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        {editing
          ? (
              <Textarea
                autoFocus
                aria-label="编辑消息内容"
                className="mt-1 min-h-12 resize-none"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onBlur={save}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    save()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setDraft(item.text)
                    setEditing(false)
                  }
                }}
              />
            )
          : (
              <p className="line-clamp-2 text-sm text-pretty wrap-break-word">{item.text}</p>
            )}
      </div>
      <div className="flex shrink-0 items-center opacity-60 transition-opacity duration-150 hover:opacity-100">
        <Tooltip>
          <TooltipTrigger render={(
            <Button className="active:scale-[0.96]" size="icon" variant="ghost" aria-label={item.delivery === 'next-turn' ? '等待当前任务结束' : '引导'} disabled={!canInject || item.delivery === 'next-turn'} onClick={() => onInject(item.id)}>
              <CornerDownLeftIcon className="size-4 cursor-pointer" />
            </Button>
          )}
          />
          <TooltipContent side="top">{item.delivery === 'next-turn' ? '当前任务结束后发送' : '引导'}</TooltipContent>
        </Tooltip>
        <Button className="active:scale-[0.96]" size="icon" variant="ghost" aria-label="编辑待处理消息" onClick={() => setEditing(true)}>
          <PencilIcon className="size-4 cursor-pointer" />
        </Button>
        <Button className="active:scale-[0.96]" size="icon" variant="ghost" aria-label="删除待处理消息" onClick={() => onRemove(item.id)}>
          <Trash2Icon className="size-4 cursor-pointer" />
        </Button>
      </div>
    </div>
  )
}
