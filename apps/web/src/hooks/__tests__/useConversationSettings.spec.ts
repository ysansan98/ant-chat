/* eslint-disable import/first */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationSettings } from '../useConversationSettings'

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

const defaultCompaction = {
  enabled: true,
  thresholdPercent: 70,
  keepRecentTokens: 20_000,
}

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
      providerId: '',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 1000,
      compaction: defaultCompaction,
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
        providerId: '',
        systemPrompt: 'You are a bot',
        temperature: 0.5,
        maxTokens: 500,
      },
    })

    const { result } = renderHook(() => useConversationSettings())
    expect(result.current.settings).toEqual({
      modelId: 'gpt-3',
      providerId: '',
      systemPrompt: 'You are a bot',
      temperature: 0.5,
      maxTokens: 500,
      compaction: defaultCompaction,
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
        providerId: '',
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

  it('should persist the compaction token retention target', async () => {
    vi.mocked(useMessagesStore).mockReturnValue('conv3')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'conv3',
      title: 'Test Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-3',
        providerId: '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 4096,
        compaction: defaultCompaction,
      },
    })

    const { result } = renderHook(() => useConversationSettings())
    await act(async () => {
      await result.current.updateSettings({
        compaction: {
          ...defaultCompaction,
          keepRecentTokens: 32_000,
        },
      })
    })

    expect(updateConversationsSettingsAction).toHaveBeenCalledWith('conv3', {
      compaction: {
        enabled: true,
        thresholdPercent: 70,
        keepRecentTokens: 32_000,
      },
    })
    expect(result.current.settings.compaction?.keepRecentTokens).toBe(32_000)
  })

  it('should reset to default settings when conversation changes to undefined', () => {
    let activeId = 'conv4'
    vi.mocked(useMessagesStore).mockImplementation(cb => cb({
      activeConversationsId: activeId,
      messages: [],
      pendingSteeringByConversation: {},
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
            providerId: '',
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
      providerId: '',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 1000,
      compaction: defaultCompaction,
    })
  })
})
