import { beforeEach, describe, expect, it } from 'vitest'
import { useConversationsStore } from '@/store/conversation'
import { handleStreamingConversationStatus } from '../useAppEventListener'

describe('handleStreamingConversationStatus', () => {
  beforeEach(() => {
    useConversationsStore.setState({
      streamingConversationIds: new Set(['conv-1']),
    })
  })

  it('does not clear streaming state when a steering user message is emitted', () => {
    handleStreamingConversationStatus({
      convId: 'conv-1',
      role: 'user',
      status: 'success',
    })

    expect(useConversationsStore.getState().streamingConversationIds.has('conv-1')).toBe(true)
  })
})
