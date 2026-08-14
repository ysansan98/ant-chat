import type { AnnotationSummaryItemData } from '@/components/Chat/annotations/AnnotationSummaryBlock'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@workspace/ui/components/ai-elements/attachments'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@workspace/ui/components/hover-card'
import { MessageSquarePlusIcon } from 'lucide-react'
import { AnnotationSummaryItem } from '@/components/Chat/annotations/AnnotationSummaryBlock'
import { useAnnotationDraftsStore } from '@/store/annotations'
import { useChatJumpStore } from '@/store/chatJump'

/**
 * Sender 输入框上方的批注预览：以附件 chip 形态展示（与附件同高、同关闭按钮），
 * hover 查看批注列表（可编辑跳转/删除单条），X 关闭全部批注草稿。
 */
export function SenderAnnotationPreview() {
  const drafts = useAnnotationDraftsStore(state => state.drafts)
  const remove = useAnnotationDraftsStore(state => state.remove)
  const clear = useAnnotationDraftsStore(state => state.clear)
  const requestDraftEdit = useAnnotationDraftsStore(state => state.requestDraftEdit)
  const jump = useChatJumpStore(state => state.jump)

  if (!drafts.length) {
    return null
  }

  const items: AnnotationSummaryItemData[] = drafts.map(draft => ({
    id: draft.id,
    quote: draft.quote,
    comment: draft.comment,
    targetMessageId: draft.targetMessageId,
  }))

  return (
    <Attachments variant="inline" className="justify-start">
      <Attachment
        data={{
          id: 'annotation-summary',
          type: 'file',
          mediaType: 'text/plain',
          filename: `${drafts.length}条注释`,
          url: '',
        }}
        onRemove={() => clear()}
      >
        <AttachmentPreview
          fallbackIcon={<MessageSquarePlusIcon className="size-3 text-muted-foreground" />}
        />
        <HoverCard>
          <HoverCardTrigger render={<AttachmentInfo />} />
          <HoverCardContent align="start" className="w-80 p-1.5">
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {items.map((item, index) => (
                <AnnotationSummaryItem
                  key={item.id}
                  item={item}
                  index={index}
                  onEdit={(editedItem) => {
                    // 立即请求滚动与草稿原位编辑：编辑层负责把引用文字滚动到可视区后再定位浮层，
                    // 不依赖滚动完成回调（长距离 smooth 滚动下回调时机不可靠）
                    jump(editedItem.targetMessageId)
                    requestDraftEdit(editedItem.id)
                  }}
                  onDelete={id => remove(id)}
                />
              ))}
            </ul>
          </HoverCardContent>
        </HoverCard>
        <AttachmentRemove label="关闭批注" />
      </Attachment>
    </Attachments>
  )
}
