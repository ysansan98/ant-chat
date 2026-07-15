import type { IMessage, IMessageContent } from '@ant-chat/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageBubble } from '../MessageBubble'

function createAssistantMessage(
  id: string,
  content: IMessageContent,
  status: IMessage['status'] = 'success',
  reasoningContent?: string,
): IMessage {
  return {
    id,
    convId: 'conv-1',
    role: 'assistant',
    content,
    status,
    createdAt: 1,
    turnId: 'turn-1',
    reasoningContent,
  }
}

function renderBubble(messages: IMessage[]) {
  return render(
    <MessageBubble
      messages={messages}
      onCopyMessage={vi.fn()}
    />,
  )
}

describe('messageBubble', () => {
  it('首个 assistant 内容为空时不展示空执行过程面板', () => {
    renderBubble([createAssistantMessage('pending', [], 'loading')])

    expect(screen.queryByText(/执行过程/)).not.toBeInTheDocument()
  })

  it('只有可视化内容时直接展示 artifact frame，不被误收进执行过程', () => {
    renderBubble([createAssistantMessage('visualization', [{
      type: 'visualization',
      source: { type: 'file_id', file_id: 'viz-1' },
      format: 'ant-chat.visualization.html.v1',
      title: '阶段延迟',
      summary: '比较阶段延迟',
      size: 32,
      sha256: '0'.repeat(64),
    }], 'success')])

    expect(screen.queryByText(/执行过程/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载可视化')
  })

  it('执行过程存在时，最终 assistant message 的可视化仍展示在结果区', () => {
    renderBubble([
      createAssistantMessage('tool-step', [{
        type: 'tool-call',
        toolCallId: 'publish-1',
        toolName: 'publish_visualization',
        args: { title: '轨道模拟' },
        executeState: 'completed',
      }]),
      createAssistantMessage('final-answer', [
        { type: 'text', text: '已完成' },
        {
          type: 'visualization',
          source: { type: 'file_id', file_id: 'viz-final' },
          format: 'ant-chat.visualization.html.v1',
          title: '轨道模拟',
          summary: '模拟轨道变化',
          size: 3,
          sha256: '0'.repeat(64),
        },
      ]),
    ])

    expect(screen.getByText('执行过程(1)')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载可视化')
  })

  it('仅有错误内容时直接展示错误，不放入可折叠的执行过程', () => {
    renderBubble([
      createAssistantMessage('failed-answer', [
        { type: 'error', error: '模型请求失败' },
      ], 'error'),
    ])

    expect(screen.queryByText(/执行过程/)).not.toBeInTheDocument()
    expect(screen.getByText('Request failed')).toBeInTheDocument()
    expect(screen.getByText('模型请求失败')).toBeInTheDocument()
  })

  it('tool 完成后等待下一段 assistant 文本时保持执行过程展开', () => {
    const toolCall = createAssistantMessage('tool-call', [{
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'pnpm check' },
      executeState: 'completed',
    }])
    const toolResult: IMessage = {
      id: 'tool-result',
      convId: 'conv-1',
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'bash',
        result: 'done',
        isError: false,
      }],
      status: 'success',
      createdAt: 2,
      turnId: 'turn-1',
    }

    renderBubble([toolCall, toolResult])

    const panel = screen.getByText('执行过程(1)').closest('[data-slot="collapsible"]')
    expect(panel).toHaveAttribute('data-open')
    expect(screen.getByText('bash')).toBeInTheDocument()
  })

  it('增量消息切换 footer 后仍按本轮首条 assistant 消息计时', () => {
    vi.useFakeTimers()
    vi.setSystemTime(11_000)

    const first = createAssistantMessage('tool-call', [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'pnpm check' },
        executeState: 'executing',
      },
    ])
    first.createdAt = 1_000
    const second = createAssistantMessage('answer-1', [{ type: 'text', text: '处理中' }], 'typing')
    second.createdAt = 9_000

    const view = renderBubble([first, second])
    expect(screen.getByText((_, element) => element?.textContent === '耗时10.0s')).toBeInTheDocument()

    const third = createAssistantMessage('answer-2', [{ type: 'text', text: '继续处理' }], 'typing')
    third.createdAt = 10_500
    view.rerender(<MessageBubble messages={[first, second, third]} onCopyMessage={vi.fn()} />)

    expect(screen.getByText((_, element) => element?.textContent === '耗时10.0s')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('renders a loading indicator for an active compaction event', () => {
    const { container } = renderBubble([
      {
        id: 'compact-event',
        convId: 'conv-1',
        role: 'event',
        status: 'loading',
        content: [{ type: 'text', text: '正在压缩上下文...' }],
        eventType: 'compaction',
        createdAt: 1,
      },
    ])

    expect(screen.getByText('正在压缩上下文')).toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('renders an open process panel with reasoning and tool steps while the agent is running', () => {
    const { container } = renderBubble([
      createAssistantMessage('thinking', [], 'success', 'Checked the current message group.'),
      createAssistantMessage('tool-call', [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'search_content',
          args: { pattern: 'groupMessage' },
        },
      ]),
      createAssistantMessage('streaming-answer', [
        { type: 'text', text: 'Reading the latest group message.' },
      ], 'typing'),
    ])

    // Process panel is open
    expect(screen.getByText('执行过程(2)')).toBeInTheDocument()
    const panel = screen.getByText('执行过程(2)').closest('[data-slot="collapsible"]') as HTMLElement
    expect(panel).toHaveAttribute('data-open')

    // Tool step is visible inside the panel
    const toolEl = within(panel).getByText('search_content')
    expect(toolEl).toBeInTheDocument()

    // Reasoning step is visible
    expect(screen.getByText('Thought complete')).toBeInTheDocument()

    // Visible message text is present (may be split across elements by Streamdown animation)
    const allText = container.textContent || ''
    expect(allText).toContain('Reading the latest group message')
    expect(container.querySelector('[data-message-id="streaming-answer"]')).not.toBeNull()
  })

  it('auto-expands streaming reasoning while it is the current step', () => {
    const { container } = renderBubble([
      createAssistantMessage('thinking', [
        { type: 'text', text: 'Preparing next action.' },
      ], 'typing', 'Reading files and planning the next step.'),
    ])

    // Process panel is open
    expect(screen.getByText('执行过程(1)')).toBeInTheDocument()
    const trigger1 = screen.getByText('执行过程(1)')
    const panel1 = trigger1.closest('[data-slot="collapsible"]') as HTMLElement
    expect(panel1).toHaveAttribute('data-open')

    // Reasoning content is visible inside the panel
    expect(within(panel1).getByText('Reading files and planning the next step.')).toBeInTheDocument()

    // Visible message text is present
    const allText = container.textContent || ''
    expect(allText).toContain('Preparing next action')
  })

  it('collapses the process panel after the agent returns the final answer', () => {
    renderBubble([
      createAssistantMessage('tool-call', [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'search_content',
          args: { pattern: 'groupMessage' },
        },
      ]),
      createAssistantMessage('final-answer', [
        { type: 'text', text: 'Final answer.' },
      ]),
    ])

    expect(screen.getByText('执行过程(1)')).toBeInTheDocument()
    expect(screen.getByText('Final answer.')).toBeInTheDocument()

    // Panel is collapsed — tool step not visible
    expect(screen.queryByText('search_content')).toBeNull()

    // Click to expand
    fireEvent.click(screen.getByText('执行过程(1)'))
    expect(screen.getByText('search_content')).toBeInTheDocument()
  })

  it('renders steering inline in the same collapsed process panel', () => {
    renderBubble([
      createAssistantMessage('tool-call', [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'search_content',
          args: { pattern: 'groupMessage' },
          executeState: 'completed',
        },
      ]),
      {
        id: 'steering-1',
        convId: 'conv-1',
        role: 'user',
        content: [{ type: 'text', text: 'Keep one execution process.' }],
        status: 'success',
        createdAt: 2,
        turnId: 'turn-1',
      },
      createAssistantMessage('final-answer', [
        { type: 'text', text: 'Updated final answer.' },
      ]),
    ])

    expect(screen.getByText('执行过程(2)')).toBeInTheDocument()
    expect(screen.getByText('Updated final answer.')).toBeInTheDocument()
    expect(screen.queryByText('追加指令')).toBeNull()

    fireEvent.click(screen.getByText('执行过程(2)'))

    expect(screen.getByText('追加指令')).toBeInTheDocument()
    expect(screen.getByText('Keep one execution process.')).toBeInTheDocument()
    expect(screen.getAllByText(/执行过程/)).toHaveLength(1)
  })

  it('keeps process panel open when tool-call has executing state', () => {
    const { container } = renderBubble([
      createAssistantMessage('with-executing-tool', [
        { type: 'text', text: 'Working on it...' },
        {
          type: 'tool-call',
          toolCallId: 'exec-1',
          toolName: 'bash',
          args: { command: 'ls' },
          executeState: 'executing',
        },
      ], 'success'),
    ])

    // Panel should be open because there's an executing tool
    const panel = container.querySelector('[data-slot="collapsible"]')
    expect(panel).toHaveAttribute('data-open')
  })

  it('运行中的 tool group 展开到工具列表，但不自动展开 tool 详情', () => {
    const toolCalls = createAssistantMessage('tool-group', [
      {
        type: 'tool-call',
        toolCallId: 'completed-tool',
        toolName: 'read_file',
        args: { path: 'README.md' },
        executeState: 'completed',
      },
      {
        type: 'tool-call',
        toolCallId: 'executing-tool',
        toolName: 'bash',
        args: { command: 'pnpm check' },
        executeState: 'executing',
      },
    ])
    const toolResult: IMessage = {
      id: 'completed-result',
      convId: 'conv-1',
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'completed-tool',
        toolName: 'read_file',
        result: '已读取 README',
        isError: false,
      }],
      status: 'success',
      createdAt: 2,
      turnId: 'turn-1',
    }

    renderBubble([toolCalls, toolResult])

    expect(screen.getByText('View 2 steps')).toBeInTheDocument()
    expect(screen.getByText('read_file')).toBeInTheDocument()
    expect(screen.getByText('bash')).toBeInTheDocument()
    expect(screen.queryByText('已读取 README')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('read_file'))

    expect(screen.getByText('已读取 README')).toBeInTheDocument()
  })

  it('renders partial assistant text before the failure alert', () => {
    const { container } = renderBubble([
      createAssistantMessage('failed-answer', [
        { type: 'text', text: '已完成部分回答' },
        { type: 'error', error: '模型请求失败' },
      ], 'error'),
    ])

    expect(screen.getByText('已完成部分回答')).toBeInTheDocument()
    expect(screen.getByText('Request failed')).toBeInTheDocument()
    expect(screen.getByText('模型请求失败')).toBeInTheDocument()
    expect((container.textContent || '').match(/模型请求失败/g)).toHaveLength(1)
  })
})
