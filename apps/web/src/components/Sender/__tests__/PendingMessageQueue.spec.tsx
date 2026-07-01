import { fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueuePendingMessage, usePendingMessagesStore } from '@/store/pendingMessages'
import { PendingMessageQueue } from '../PendingMessageQueue'

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('pendingMessageQueue', () => {
  beforeEach(() => {
    usePendingMessagesStore.setState({ itemsByConversation: {} })
  })

  it('乱序输入后渲染消息列表', () => {
    enqueuePendingMessage('conv-1', '后发消息')
    enqueuePendingMessage('conv-1', '先发消息')
    const onInject = vi.fn()
    renderWithTooltip(<PendingMessageQueue conversationId="conv-1" canInject onInject={onInject} onEdit={vi.fn()} onRemove={vi.fn()} />)
    const [injectButtons, editButtons, deleteButtons] = screen.getAllByRole('button')
    expect(injectButtons).toBeInTheDocument()
    expect(editButtons).toBeInTheDocument()
    expect(deleteButtons).toBeInTheDocument()
    fireEvent.click(injectButtons)
    expect(onInject).toHaveBeenCalled()
  })

  it('无 pending 消息时返回 null', () => {
    const { container } = renderWithTooltip(<PendingMessageQueue conversationId="conv-1" canInject={false} onInject={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('编辑保存后调用 onEdit', () => {
    enqueuePendingMessage('conv-1', '原文')
    const onEdit = vi.fn()
    renderWithTooltip(<PendingMessageQueue conversationId="conv-1" canInject={false} onInject={vi.fn()} onEdit={onEdit} onRemove={vi.fn()} />)
    expect(screen.getByText('原文')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑待处理消息' }))
    const editor = screen.getByRole('textbox', { name: '编辑消息内容' })
    fireEvent.change(editor, { target: { value: '修改后' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith(expect.any(String), '修改后')
  })
})
