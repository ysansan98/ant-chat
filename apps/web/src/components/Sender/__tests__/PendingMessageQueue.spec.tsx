import { fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingMessagesStore } from '@/store/pendingMessages'
import { PendingMessageQueue } from '../PendingMessageQueue'

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

function seedMessages(conversationId: string, texts: string[]) {
  usePendingMessagesStore.setState({
    itemsByConversation: {
      [conversationId]: texts.map((text, index) => ({
        id: `p-${index}`,
        conversationId,
        text,
        source: 'sender' as const,
        createdAt: index + 1,
      })),
    },
    revisionByConversation: { [conversationId]: 1 },
  })
}

describe('pendingMessageQueue', () => {
  beforeEach(() => {
    usePendingMessagesStore.setState({ itemsByConversation: {}, revisionByConversation: {} })
  })

  it('渲染服务端快照顺序并提供引导/编辑/删除操作', () => {
    seedMessages('conv-1', ['第一条', '第二条'])
    const onSteer = vi.fn()
    renderWithTooltip(<PendingMessageQueue conversationId="conv-1" canSteer onSteer={onSteer} onEdit={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getAllByText('第一条')).toHaveLength(1)
    expect(screen.getAllByText('第二条')).toHaveLength(1)
    const [injectButtons, editButtons, deleteButtons] = screen.getAllByRole('button')
    expect(injectButtons).toBeInTheDocument()
    expect(editButtons).toBeInTheDocument()
    expect(deleteButtons).toBeInTheDocument()
    fireEvent.click(injectButtons)
    expect(onSteer).toHaveBeenCalled()
  })

  it('无 pending 消息时返回 null', () => {
    const { container } = renderWithTooltip(<PendingMessageQueue conversationId="conv-1" canSteer={false} onSteer={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('编辑保存后调用 onEdit', () => {
    seedMessages('conv-1', ['原文'])
    const onEdit = vi.fn()
    renderWithTooltip(<PendingMessageQueue conversationId="conv-1" canSteer={false} onSteer={vi.fn()} onEdit={onEdit} onRemove={vi.fn()} />)
    expect(screen.getByText('原文')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑待处理消息' }))
    const editor = screen.getByRole('textbox', { name: '编辑消息内容' })
    fireEvent.change(editor, { target: { value: '修改后' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith(expect.any(String), '修改后')
  })
})
