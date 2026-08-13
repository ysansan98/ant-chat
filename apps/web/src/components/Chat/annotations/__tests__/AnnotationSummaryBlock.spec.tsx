import type { AnnotationSummaryItemData } from '../AnnotationSummaryBlock'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnnotationSummaryBlock, AnnotationSummaryItem } from '../AnnotationSummaryBlock'

const ITEMS: AnnotationSummaryItemData[] = [
  { id: 'a1', quote: '引用一', comment: '评论一', targetMessageId: 'msg-a1' },
  { id: 'a2', quote: '引用二', comment: '', targetMessageId: 'msg-a2' },
]

describe('annotationSummaryBlock', () => {
  it('无批注时不渲染', () => {
    const { container } = render(
      <AnnotationSummaryBlock items={[]} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('有批注时渲染"n条注释"块', () => {
    render(<AnnotationSummaryBlock items={ITEMS} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: /2条注释/ })).toBeInTheDocument()
  })
})

describe('annotationSummaryItem', () => {
  it('hover 显示删除按钮，删除直接回调（无需二次确认）', () => {
    const onDelete = vi.fn()
    render(
      <AnnotationSummaryItem item={ITEMS[0]} index={0} onEdit={vi.fn()} onDelete={onDelete} />,
    )
    expect(screen.getByText('1')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByText('引用一'))
    fireEvent.click(screen.getByRole('button', { name: '删除批注' }))
    expect(onDelete).toHaveBeenCalledWith('a1')
  })

  it('编辑按钮回调携带完整条目数据', () => {
    const onEdit = vi.fn()
    render(
      <AnnotationSummaryItem item={ITEMS[1]} index={1} onEdit={onEdit} onDelete={vi.fn()} />,
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByText('引用二'))
    fireEvent.click(screen.getByRole('button', { name: '编辑批注' }))
    expect(onEdit).toHaveBeenCalledWith(ITEMS[1])
  })

  it('只读模式（无编辑/删除回调）不渲染操作按钮', () => {
    render(<AnnotationSummaryItem item={ITEMS[0]} index={0} />)
    expect(screen.queryByRole('button', { name: '编辑批注' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除批注' })).not.toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
