import { AnnotationSummaryBlock } from '@/components/Chat/annotations/AnnotationSummaryBlock'
import { useAnnotationDraftsStore } from '@/store/annotations'
import { useChatJumpStore } from '@/store/chatJump'

/** Sender 输入框上方的批注预览：与消息列表复用同一个"n条注释"汇总块组件。 */
export function SenderAnnotationPreview() {
  const drafts = useAnnotationDraftsStore(state => state.drafts)
  const remove = useAnnotationDraftsStore(state => state.remove)
  const requestDraftEdit = useAnnotationDraftsStore(state => state.requestDraftEdit)
  const jump = useChatJumpStore(state => state.jump)

  if (!drafts.length) {
    return null
  }

  return (
    // PromptInput 内部布局会居中内容，显式左对齐（与附件预览一致）
    <div className="mb-2 flex w-full justify-start px-1 pt-1">
      <AnnotationSummaryBlock
        items={drafts.map(draft => ({
          id: draft.id,
          quote: draft.quote,
          comment: draft.comment,
          targetMessageId: draft.targetMessageId,
        }))}
        onEdit={(item) => {
          // 立即请求滚动与草稿原位编辑：编辑层负责把引用文字滚动到可视区后再定位浮层，
          // 不依赖滚动完成回调（长距离 smooth 滚动下回调时机不可靠）
          jump(item.targetMessageId)
          requestDraftEdit(item.id)
        }}
        onDelete={id => remove(id)}
      />
    </div>
  )
}
