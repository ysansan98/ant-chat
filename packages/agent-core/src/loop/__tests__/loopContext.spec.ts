import type { IMessage } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { buildConversationContextMessages } from '../loopContext'

function textMessage(input: {
  id: string
  role: 'user' | 'assistant' | 'event'
  text: string
  createdAt: number
  eventType?: string
}): IMessage {
  return {
    id: input.id,
    convId: 'conv-1',
    createdAt: input.createdAt,
    role: input.role,
    status: 'success',
    content: [{ type: 'text', text: input.text }],
    eventType: input.eventType,
  }
}

function userTexts(messages: Awaited<ReturnType<typeof buildConversationContextMessages>>): string[] {
  return messages
    .filter(message => message.role === 'user')
    .flatMap(message => message.content)
    .filter(part => part.type === 'text')
    .map(part => part.text)
}

describe('buildConversationContextMessages', () => {
  it('injects compaction summary and only includes messages after the compaction event', async () => {
    const messages: IMessage[] = [
      textMessage({ id: 'old-user', role: 'user', text: 'old user message', createdAt: 100 }),
      textMessage({ id: 'old-assistant', role: 'assistant', text: 'old assistant message', createdAt: 100 }),
      textMessage({ id: 'compact-event', role: 'event', text: 'summary text', createdAt: 100, eventType: 'compaction' }),
      textMessage({ id: 'new-user', role: 'user', text: 'new user message', createdAt: 100 }),
      textMessage({ id: 'new-assistant', role: 'assistant', text: 'new assistant message', createdAt: 101 }),
      textMessage({ id: 'current-user', role: 'user', text: 'current user message', createdAt: 102 }),
    ]

    const result = await buildConversationContextMessages(
      messages,
      'current-user',
      'compressed summary',
      'compact-event',
    )

    const texts = userTexts(result)
    expect(texts[0]).toContain('compressed summary')
    expect(texts).toContain('new user message')
    expect(texts).not.toContain('old user message')
    expect(texts).not.toContain('current user message')
    expect(result.some(message =>
      message.role === 'assistant'
      && message.content.some(part => part.type === 'text' && part.text === 'new assistant message'),
    )).toBe(true)
  })

  it('does not inject compaction summary without a compaction boundary id', async () => {
    const messages: IMessage[] = [
      textMessage({ id: 'old-user', role: 'user', text: 'old user message', createdAt: 100 }),
      textMessage({ id: 'current-user', role: 'user', text: 'current user message', createdAt: 101 }),
    ]

    const result = await buildConversationContextMessages(
      messages,
      'current-user',
      'compressed summary',
    )

    expect(userTexts(result)).toEqual(['old user message'])
  })

  it('uses the configured compaction event id when multiple compaction events exist', async () => {
    const messages: IMessage[] = [
      textMessage({ id: 'before-first', role: 'user', text: 'before first compaction', createdAt: 100 }),
      textMessage({ id: 'compact-event-1', role: 'event', text: 'first summary', createdAt: 101, eventType: 'compaction' }),
      textMessage({ id: 'between-events', role: 'user', text: 'between compactions', createdAt: 102 }),
      textMessage({ id: 'compact-event-2', role: 'event', text: 'second summary', createdAt: 103, eventType: 'compaction' }),
      textMessage({ id: 'after-second', role: 'user', text: 'after second compaction', createdAt: 104 }),
      textMessage({ id: 'current-user', role: 'user', text: 'current user message', createdAt: 105 }),
    ]

    const result = await buildConversationContextMessages(
      messages,
      'current-user',
      'latest compressed summary',
      'compact-event-2',
    )

    const texts = userTexts(result)
    expect(texts[0]).toContain('latest compressed summary')
    expect(texts).toContain('after second compaction')
    expect(texts).not.toContain('before first compaction')
    expect(texts).not.toContain('between compactions')
  })
})
