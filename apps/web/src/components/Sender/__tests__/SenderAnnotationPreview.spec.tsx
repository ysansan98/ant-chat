import type { AnnotationDraft } from '@/components/Chat/annotations/annotationDraft'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('存在批注草稿时渲染附件 chip（数量文本 + 关闭按钮）', () => {
    useAnnotationDraftsStore.setState({
      drafts: [createDraft(), createDraft({ id: 'a2', comment: '' })],
    })
    render(<SenderAnnotationPreview />)
    expect(screen.getByText('2条注释')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭批注' })).toBeInTheDocument()
  })

  it('点击关闭按钮清空全部批注草稿', () => {
    useAnnotationDraftsStore.setState({
      drafts: [createDraft(), createDraft({ id: 'a2', comment: '' })],
    })
    render(<SenderAnnotationPreview />)
    fireEvent.click(screen.getByRole('button', { name: '关闭批注' }))
    expect(useAnnotationDraftsStore.getState().drafts).toHaveLength(0)
  })

  it('hover chip 显示批注列表', async () => {
    useAnnotationDraftsStore.setState({ drafts: [createDraft()] })
    render(<SenderAnnotationPreview />)
    // base-ui HoverCard 需要完整 pointer 序列，userEvent.hover 可触发
    await userEvent.hover(screen.getByText('1条注释'))
    await waitFor(() => {
      expect(screen.getByText('原回复内容')).toBeInTheDocument()
      expect(screen.getByText('这段要改')).toBeInTheDocument()
    })
  })

  it('无批注草稿时不渲染', () => {
    useAnnotationDraftsStore.setState({ drafts: [createDraft()] })
    const { rerender } = render(<SenderAnnotationPreview />)
    expect(screen.getByText('1条注释')).toBeInTheDocument()
    useAnnotationDraftsStore.setState({ drafts: [] })
    rerender(<SenderAnnotationPreview />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
