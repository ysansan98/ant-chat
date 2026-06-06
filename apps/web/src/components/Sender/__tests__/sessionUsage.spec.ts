import type { IMessage } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { calculateSessionUsage } from '../sessionUsage'

describe('calculateSessionUsage', () => {
  it('includes assistant and compaction event usage', () => {
    const messages: IMessage[] = [
      {
        id: 'assistant-1',
        convId: 'conv-1',
        createdAt: 1,
        role: 'assistant',
        status: 'success',
        content: [{ type: 'text', text: 'answer' }],
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
      },
      {
        id: 'event-1',
        convId: 'conv-1',
        createdAt: 2,
        role: 'event',
        status: 'success',
        eventType: 'compaction',
        compactedThroughMessageId: 'assistant-1',
        content: [{ type: 'text', text: 'summary' }],
        usage: {
          inputTokens: 80,
          outputTokens: 10,
          totalTokens: 90,
        },
      },
    ]

    expect(calculateSessionUsage(messages)).toEqual({
      inputTokens: 180,
      outputTokens: 30,
      totalTokens: 210,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: {
        reasoningTokens: undefined,
        textTokens: undefined,
      },
    })
  })
})
