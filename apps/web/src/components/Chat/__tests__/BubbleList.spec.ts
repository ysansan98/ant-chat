import type { IMessage } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { getRootUserMessages, groupMessages } from '../messageGrouping'

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

describe('groupMessages', () => {
  it('keeps steering and assistant output in one turn group', () => {
    const messages = [
      createMessage('user-1', 'user'),
      createMessage('assistant-1', 'assistant', 'user-1'),
      createMessage('tool-1', 'tool', 'user-1'),
      createMessage('steering-1', 'user', 'user-1'),
      createMessage('assistant-2', 'assistant', 'user-1'),
    ]
    const groups = groupMessages(messages)

    expect(groups.map(group => group.map(message => message.id))).toEqual([
      ['user-1'],
      ['assistant-1', 'tool-1', 'steering-1', 'assistant-2'],
    ])
    expect(getRootUserMessages(messages).map(message => message.id)).toEqual(['user-1'])
  })
})
