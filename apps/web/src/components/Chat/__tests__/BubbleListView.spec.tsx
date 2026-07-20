import type { IMessage } from '@ant-chat/shared'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentRuntimeStore } from '@/store/agentRuntime'
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

beforeEach(() => {
  useAgentRuntimeStore.setState({ tasks: {}, executionPhaseByTurn: {}, pendingByTask: {}, secretRequests: {} })
})

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
  it('展示 agent loop 事件携带的执行阶段', () => {
    const task = {
      taskId: 'task-1',
      conversationId: 'conv-1',
      userMessageId: 'user-1',
      workspacePath: '/workspace',
      mode: 'hybrid' as const,
      status: 'running' as const,
      executionPhase: 'waiting_model' as const,
      createdAt: 1,
      updatedAt: 1,
      prompt: '开始任务',
    }
    useAgentRuntimeStore.getState().setTask(task)

    const assistantMessage = createMessage('tool-call', 'assistant', [{
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'pnpm check' },
      executeState: 'executing',
    }], 'success')
    assistantMessage.turnId = undefined

    const view = render(
      <BubbleList
        messages={[
          createMessage('user-1', 'user', [{ type: 'text', text: '开始任务' }], 'success'),
        ]}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('等待模型回复')

    act(() => {
      useAgentRuntimeStore.getState().setTask({ ...task, executionPhase: 'using_tool' })
    })
    view.rerender(
      <BubbleList
        messages={[
          createMessage('user-1', 'user', [{ type: 'text', text: '开始任务' }], 'success'),
          assistantMessage,
        ]}
      />,
    )

    const runningStatus = screen.getByRole('status')
    const elapsedTime = screen.getByText(/耗时/)
    expect(runningStatus).toHaveTextContent('正在使用工具')
    expect(runningStatus.compareDocumentPosition(elapsedTime) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    act(() => {
      useAgentRuntimeStore.getState().setTask({ ...task, status: 'success' })
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

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

    const view = render(<BubbleList messages={messages} />)
    const trigger = screen.getByText('执行过程(1)')
    fireEvent.click(trigger)
    expect(trigger.closest('[data-slot="collapsible"]')).toHaveAttribute('data-closed')

    view.rerender(
      <BubbleList
        messages={[
          ...messages,
          createMessage('answer-2', 'assistant', [{ type: 'text', text: '继续处理' }], 'typing'),
        ]}
      />,
    )

    expect(screen.getByText('执行过程(2)').closest('[data-slot="collapsible"]')).toHaveAttribute('data-closed')
    expect(Element.prototype.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })
})
