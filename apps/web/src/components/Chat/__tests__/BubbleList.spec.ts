import type { IMessage } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { buildConversationItems, getRootUserMessages } from '../conversationItems'

function createMessage(
  id: string,
  role: IMessage['role'],
  turnId?: string,
): IMessage {
  return {
    id,
    convId: 'conv-1',
    role,
    status: 'success',
    content: [{ type: 'text', text: id }],
    createdAt: 1,
    turnId,
  }
}

describe('buildConversationItems', () => {
  it('将用户消息、追加指令和 assistant 输出建模为同一个 turn', () => {
    const messages = [
      createMessage('user-1', 'user'),
      createMessage('assistant-1', 'assistant', 'user-1'),
      createMessage('tool-1', 'tool', 'user-1'),
      createMessage('steering-1', 'user', 'user-1'),
      createMessage('assistant-2', 'assistant', 'user-1'),
    ]
    const items = buildConversationItems(messages, { 'user-1': 'using_tool' })
    const turns = items.flatMap(item => item.type === 'turn' ? [item.turn] : [])

    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage?.id).toBe('user-1')
    expect(turns[0].responseMessages.map(message => message.id)).toEqual([
      'assistant-1',
      'tool-1',
      'steering-1',
      'assistant-2',
    ])
    expect(turns[0].executionPhase).toBe('using_tool')
    expect(turns[0].status).toBe('running')
    expect(getRootUserMessages(items).map(message => message.id)).toEqual(['user-1'])
  })

  it('将系统事件保留为 turn 之外的独立列表项', () => {
    const event = createMessage('event-1', 'event')
    event.eventType = 'compaction'

    const items = buildConversationItems([
      createMessage('user-1', 'user'),
      event,
      createMessage('assistant-1', 'assistant', 'user-1'),
    ], {})

    expect(items.map(item => item.type)).toEqual(['turn', 'event'])
  })
})
