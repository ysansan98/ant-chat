import type { IMessage } from '@ant-chat/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BubbleList from '../BubbleList'

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = []
  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}

  disconnect = vi.fn()
  observe = vi.fn()
  takeRecords = vi.fn(() => [])
  unobserve = vi.fn()
}

vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

function createMessage(id: string, role: IMessage['role'], content: IMessage['content'], status: IMessage['status']): IMessage {
  return {
    id,
    convId: 'conv-1',
    role,
    content,
    status,
    createdAt: 1,
    turnId: role === 'user' ? undefined : 'user-1',
  }
}

describe('bubbleList', () => {
  it('同一轮增量消息到达时保留用户关闭的执行过程状态', () => {
    const messages = [
      createMessage('user-1', 'user', [{ type: 'text', text: '开始任务' }], 'success'),
      createMessage('tool-call', 'assistant', [{
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'pnpm check' },
        executeState: 'executing',
      }], 'success'),
      createMessage('answer-1', 'assistant', [{ type: 'text', text: '处理中' }], 'typing'),
    ]

    const view = render(<BubbleList messages={messages} conversationsId="conv-1" />)
    const trigger = screen.getByText('执行过程(1)')
    fireEvent.click(trigger)
    expect(trigger.closest('[data-slot="collapsible"]')).toHaveAttribute('data-state', 'closed')

    view.rerender(
      <BubbleList
        messages={[
          ...messages,
          createMessage('answer-2', 'assistant', [{ type: 'text', text: '继续处理' }], 'typing'),
        ]}
        conversationsId="conv-1"
      />,
    )

    expect(screen.getByText('执行过程(2)').closest('[data-slot="collapsible"]')).toHaveAttribute('data-state', 'closed')
    expect(Element.prototype.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })
})
