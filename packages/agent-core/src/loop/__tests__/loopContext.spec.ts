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
  it('replaces messages through the latest compaction boundary and keeps later messages', async () => {
    const messages = [
      textMessage('u1', 'user', 'old user'),
      textMessage('a1', 'assistant', 'old assistant'),
      textMessage('u2', 'user', 'kept user'),
      textMessage('a2', 'assistant', 'kept assistant'),
      {
        id: 'evt-1',
        convId: 'conv-1',
        createdAt: 1,
        role: 'event' as const,
        status: 'success' as const,
        eventType: 'compaction',
        compactedThroughMessageId: 'a1',
        content: [{ type: 'text' as const, text: 'event summary' }],
      },
      textMessage('current', 'user', 'current prompt'),
    ]

    const result = await buildConversationContextMessages(
      messages,
      'current',
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: [{
          type: 'text',
          text: [
            'Previous conversation history has been compressed into the following summary:',
            '<summary>',
            'event summary',
            '</summary>',
            'Continue the task based on the above summary and subsequent conversation.',
          ].join('\n'),
        }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'kept user' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'kept assistant' }],
      },
    ])
  })

  it('rejects a compaction event without summary text', async () => {
    await expect(buildConversationContextMessages(
      [
        textMessage('u1', 'user', 'old user'),
        {
          id: 'evt-1',
          convId: 'conv-1',
          createdAt: 1,
          role: 'event' as const,
          status: 'success' as const,
          eventType: 'compaction',
          compactedThroughMessageId: 'u1',
          content: [{ type: 'text' as const, text: '  ' }],
        },
      ],
      'current',
    )).rejects.toThrow('Compaction event missing summary text: evt-1')
  })

  it('rejects a missing compaction boundary message', async () => {
    await expect(buildConversationContextMessages([
      {
        id: 'evt-1',
        convId: 'conv-1',
        createdAt: 1,
        role: 'event',
        status: 'success',
        eventType: 'compaction',
        compactedThroughMessageId: 'missing',
        content: [{ type: 'text', text: 'summary' }],
      },
    ])).rejects.toThrow('Compaction boundary message not found: missing')
  })
})
