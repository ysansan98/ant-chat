import { describe, expect, it } from 'vitest'
import { useConversationsStore } from '@/store/conversation'
import { setConversationState, removeConversationState } from '@/store/conversation'

describe('conversation state management', () => {
  beforeEach(() => {
    useConversationsStore.setState({
      conversationStates: {},
      activeConversationsId: '',
    })
  })

  it('setConversationState stores streaming state', () => {
    setConversationState('conv-1', 'running')
    expect(useConversationsStore.getState().conversationStates['conv-1']).toBe('running')
  })

  it('setConversationState stores completed state', () => {
    setConversationState('conv-1', 'completed')
    expect(useConversationsStore.getState().conversationStates['conv-1']).toBe('completed')
  })

  it('removeConversationState clears state', () => {
    setConversationState('conv-1', 'running')
    removeConversationState('conv-1')
    expect(useConversationsStore.getState().conversationStates['conv-1']).toBeUndefined()
  })

  it('setConversationState overwrites previous state', () => {
    setConversationState('conv-1', 'completed')
    setConversationState('conv-1', 'running')
    expect(useConversationsStore.getState().conversationStates['conv-1']).toBe('running')
  })

  it('a conversation cannot be both streaming and completed', () => {
    setConversationState('conv-1', 'running')
    setConversationState('conv-1', 'completed')
    // After setting to completed, it should NOT be streaming
    expect(useConversationsStore.getState().conversationStates['conv-1']).toBe('completed')
    expect(useConversationsStore.getState().conversationStates['conv-1']).not.toBe('running')
  })
})
