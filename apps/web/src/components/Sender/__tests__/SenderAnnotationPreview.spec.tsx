import type { AnnotationDraft } from '@/components/Chat/annotations/annotationDraft'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAnnotationDraftsStore } from '@/store/annotations'
import { SenderAnnotationPreview } from '../SenderAnnotationPreview'

function createDraft(overrides: Partial<AnnotationDraft> = {}): AnnotationDraft {
  return {
    id: 'a1',
    stepId: 'step-1',
    targetMessageId: 'msg-target',
    quote: '原回复内容',
    comment: '这段要改',
    start: 0,
    end: 5,
    ...overrides,
  }
}

describe('senderAnnotationPreview', () => {
  beforeEach(() => {
    useAnnotationDraftsStore.setState({ drafts: [], activeId: null })
  })

  it('草稿清空后不再渲染', () => {
    const { container } = render(<SenderAnnotationPreview />)
    expect(container.innerHTML).toBe('')
  })

  it('存在批注草稿时渲染"n条注释"汇总块（与消息列表同组件）', () => {
    useAnnotationDraftsStore.setState({
      drafts: [createDraft(), createDraft({ id: 'a2', comment: '' })],
    })
    render(<SenderAnnotationPreview />)
    expect(screen.getByRole('button', { name: /2条注释/ })).toBeInTheDocument()
  })

  it('无批注草稿时不渲染', () => {
    useAnnotationDraftsStore.setState({ drafts: [createDraft()] })
    const { rerender } = render(<SenderAnnotationPreview />)
    expect(screen.getByRole('button', { name: /1条注释/ })).toBeInTheDocument()
    useAnnotationDraftsStore.setState({ drafts: [] })
    rerender(<SenderAnnotationPreview />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
