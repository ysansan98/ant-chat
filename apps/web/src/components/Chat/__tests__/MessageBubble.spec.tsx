import type { IMessage, IMessageContent } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  render(
    <MessageBubble
      messages={messages}
      onCopyMessage={vi.fn()}
    />,
  )
}

describe('messageBubble', () => {
  it('renders an open process panel with reasoning and tool steps while the agent is running', async () => {
    renderBubble([
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

    expect(screen.getByText('执行过程(2)')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('search_content')).toBeInTheDocument())
    expect(screen.getByText('Thought complete')).toBeInTheDocument()
    expect(screen.queryByText('Checked the current message group.')).toBeNull()
    expect(screen.getByText('Reading the latest group message.')).toBeInTheDocument()
  })

  it('auto-expands streaming reasoning while it is the current step', async () => {
    renderBubble([
      createAssistantMessage('thinking', [
        { type: 'text', text: 'Preparing next action.' },
      ], 'typing', 'Reading files and planning the next step.'),
    ])

    expect(screen.getByText('执行过程(1)')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Reading files and planning the next step.')).toBeInTheDocument())
    expect(screen.getByText('Preparing next action.')).toBeInTheDocument()
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
    expect(screen.queryByText('search_content')).toBeNull()

    fireEvent.click(screen.getByText('执行过程(1)'))

    expect(screen.getByText('search_content')).toBeInTheDocument()
  })
})
