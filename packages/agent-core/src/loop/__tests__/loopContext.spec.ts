import type { IMessage } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { buildConversationContextMessages } from '../loopContext'

function textMessage(id: string, role: 'user' | 'assistant', text: string): IMessage {
  return {
    id,
    convId: 'conv-1',
    createdAt: 1,
    role,
    status: 'success',
    content: [{ type: 'text', text }],
  }
}

describe('buildConversationContextMessages', () => {
  it('replaces messages up to lastCompactedMessageId with the compaction summary', async () => {
    const messages = [
      textMessage('u1', 'user', 'old user'),
      textMessage('a1', 'assistant', 'old assistant'),
      {
        id: 'evt-1',
        convId: 'conv-1',
        createdAt: 1,
        role: 'event' as const,
        status: 'success' as const,
        eventType: 'compaction',
        content: [{ type: 'text' as const, text: 'event summary' }],
      },
      textMessage('u2', 'user', 'kept user'),
      textMessage('current', 'user', 'current prompt'),
    ]

    const result = await buildConversationContextMessages(
      messages,
      'current',
      'a1',
      'old summary',
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: [{
          type: 'text',
          text: [
            'Previous conversation history has been compressed into the following summary:',
            '<summary>',
            'old summary',
            '</summary>',
            'Continue the task based on the above summary and subsequent conversation.',
          ].join('\n'),
        }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'kept user' }],
      },
    ])
  })

  it('rejects a missing compaction boundary id', async () => {
    await expect(buildConversationContextMessages(
      [textMessage('u1', 'user', 'old user')],
      'current',
      'missing-id',
      'old summary',
    )).rejects.toThrow('Compaction boundary message not found: missing-id')
  })
})
