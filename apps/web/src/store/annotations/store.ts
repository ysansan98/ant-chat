import type { AnnotationDraft } from '@/components/Chat/annotations/annotationDraft'
import { create } from 'zustand'

/**
 * 发送前批注草稿的全局状态：用户在模型回复上添加的批注在这里暂存，
 * MessageBubble（编辑态）与 Sender（发送前预览）共同读写；
 * 发送成功后由调用方 clear。
 */
interface AnnotationDraftsState {
  drafts: AnnotationDraft[]
  activeId: string | null
  add: (draft: Omit<AnnotationDraft, 'id'>) => void
  update: (id: string, comment: string) => void
  remove: (id: string) => void
  activate: (id: string | null) => void
  clear: () => void
  /** 草稿编辑请求：Sender 预览发起，assistant 气泡的原位编辑层响应 */
  editingDraftId: string | null
  requestDraftEdit: (id: string | null) => void
}

export const useAnnotationDraftsStore = create<AnnotationDraftsState>()(
  set => ({
    drafts: [],
    activeId: null,
    editingDraftId: null,
    add: (draft) => {
      set(state => ({
        drafts: [...state.drafts, { id: crypto.randomUUID(), ...draft }],
      }))
    },
    update: (id, comment) => {
      set(state => ({
        drafts: state.drafts.map(item => (item.id === id ? { ...item, comment } : item)),
      }))
    },
    remove: (id) => {
      set(state => ({
        drafts: state.drafts.filter(item => item.id !== id),
        activeId: state.activeId === id ? null : state.activeId,
      }))
    },
    activate: (id) => {
      set({ activeId: id })
    },
    clear: () => {
      set({ drafts: [], activeId: null })
    },
    requestDraftEdit: (id) => {
      set({ editingDraftId: id })
    },
  }),
)
