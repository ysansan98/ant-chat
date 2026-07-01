import { beforeEach, describe, expect, it } from 'vitest'
import { useConversationsStore } from '@/store/conversation'
import { handleConversationTurnFinished, handleStreamingConversationStatus } from '../useAppEventListener'

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

describe('handleConversationTurnFinished', () => {
  beforeEach(() => {
    useConversationsStore.setState({
      activeConversationsId: 'conv-active',
      completedConversationIds: new Set(),
    })
  })

  it('非当前会话运行成功后展示已完成状态', () => {
    handleConversationTurnFinished({ conversationId: 'conv-background', status: 'success' })

    expect(useConversationsStore.getState().completedConversationIds.has('conv-background')).toBe(true)
  })

  it('当前会话运行结束或后台任务取消时不展示已完成状态', () => {
    handleConversationTurnFinished({ conversationId: 'conv-active', status: 'success' })
    handleConversationTurnFinished({ conversationId: 'conv-cancelled', status: 'cancel' })

    expect(useConversationsStore.getState().completedConversationIds.size).toBe(0)
  })
})
