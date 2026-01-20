/* eslint-disable import/first */
import { act, renderHook } from '@testing-library/react'
import { useConversationSettings } from '../useConversationSettings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('@/store/conversation', () => ({
  getConversationByIdAction: vi.fn(),
  updateConversationsSettingsAction: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/store/messages', () => ({
  useMessagesStore: vi.fn(),
}))

import { getConversationByIdAction, updateConversationsSettingsAction } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'

vi.mock('use-immer', async () => {
  const actual = await vi.importActual('use-immer')
  return actual
})

describe('useConversationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return default settings if no conversation is found', () => {
    vi.mocked(useMessagesStore).mockReturnValue(() => 'conv1')
    vi.mocked(getConversationByIdAction).mockReturnValue(undefined)

    const { result } = renderHook(() => useConversationSettings())
    expect(result.current.settings).toEqual({
      modelId: '',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 1000,
    })
  })

  it('should return conversation settings if conversation exists', () => {
    vi.mocked(useMessagesStore).mockReturnValue(() => 'conv2')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'conv2',
      title: 'Test Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-3',
        systemPrompt: 'You are a bot',
        temperature: 0.5,
        maxTokens: 500,
      },
    })

    const { result } = renderHook(() => useConversationSettings())
    expect(result.current.settings).toEqual({
      modelId: 'gpt-3',
      systemPrompt: 'You are a bot',
      temperature: 0.5,
      maxTokens: 500,
    })
  })

  it('should update settings and call updateConversationsSettingsAction', async () => {
    vi.mocked(useMessagesStore).mockReturnValue('conv3')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'conv3',
      title: 'Test Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-3',
        systemPrompt: 'You are a bot',
        temperature: 0.5,
        maxTokens: 500,
      },
    })

    const { result } = renderHook(() => useConversationSettings())
    await act(async () => {
      await result.current.updateSettings({
        modelId: 'gpt-4',
        temperature: 0.9,
      })
    })

    expect(updateConversationsSettingsAction).toHaveBeenCalledWith('conv3', {
      modelId: 'gpt-4',
      temperature: 0.9,
    })
    expect(result.current.settings.modelId).toBe('gpt-4')
    expect(result.current.settings.temperature).toBe(0.9)
    expect(result.current.settings.systemPrompt).toBe('You are a bot')
    expect(result.current.settings.maxTokens).toBe(500)
  })

  it('should reset to default settings when conversation changes to undefined', () => {
    let activeId = 'conv4'
    vi.mocked(useMessagesStore).mockImplementation(cb => cb({
      activeConversationsId: activeId,
      messages: [],
      pageIndex: 0,
      pageSize: 0,
      messageTotal: 0,
      reset(): void {
        throw new Error('Function not implemented.')
      },
    }))

    vi.mocked(getConversationByIdAction).mockImplementation((id) => {
      if (id === 'conv4') {
        return {
          id: 'conv4',
          title: 'Test Conversation',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          settings: {
            modelId: 'gpt-3',
            systemPrompt: 'Prompt',
            temperature: 0.6,
            maxTokens: 800,
          },
        }
      }
      return undefined
    })

    const { result, rerender } = renderHook(() => useConversationSettings())
    expect(result.current.settings.modelId).toBe('gpt-3')

    // Simulate conversation change
    activeId = ''
    rerender()
    expect(result.current.settings).toEqual({
      modelId: '',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 1000,
    })
  })
})
