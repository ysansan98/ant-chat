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
  it('replaces messages up to the latest manual compaction event with the event summary', async () => {
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
    ])
  })

  it('ignores automatic compaction events when rebuilding persisted conversation context', async () => {
    const messages = [
      textMessage('u1', 'user', 'old user'),
      {
        id: 'auto-evt-1',
        convId: 'conv-1',
        createdAt: 1,
        role: 'event' as const,
        status: 'success' as const,
        eventType: 'compaction',
        turnId: 'u1',
        content: [{ type: 'text' as const, text: 'automatic summary' }],
      },
      textMessage('current', 'user', 'current prompt'),
    ]

    const result = await buildConversationContextMessages(messages, 'current')

    expect(result).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'old user' }],
      },
    ])
  })

  it('rejects a manual compaction event without summary text', async () => {
    await expect(buildConversationContextMessages(
      [{
        id: 'evt-1',
        convId: 'conv-1',
        createdAt: 1,
        role: 'event' as const,
        status: 'success' as const,
        eventType: 'compaction',
        content: [{ type: 'text' as const, text: '  ' }],
      }],
      'current',
    )).rejects.toThrow('Compaction event missing summary text: evt-1')
  })
})
