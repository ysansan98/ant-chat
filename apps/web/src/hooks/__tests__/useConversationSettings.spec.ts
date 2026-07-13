/* eslint-disable import/first */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationSettings } from '../useConversationSettings'

// Mock dependencies
vi.mock('@/store/conversation', () => ({
  getConversationByIdAction: vi.fn(),
  updateConversationInstructionsAction: vi.fn().mockResolvedValue(undefined),
  updateConversationsSettingsAction: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/store/messages', () => ({
  useMessagesStore: vi.fn(),
}))

import {
  getConversationByIdAction,
  updateConversationInstructionsAction,
  updateConversationsSettingsAction,
} from '@/store/conversation'
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
      temperature: 0.7,
      maxOutputTokens: 1000,
      compaction: defaultCompaction,
    })
  })

  it('should return conversation settings if conversation exists', () => {
    vi.mocked(useMessagesStore).mockReturnValue(() => 'conv2')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'conv2',
      title: 'Test Conversation',
      conversationInstructions: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-3',
        providerId: '',
        temperature: 0.5,
        maxOutputTokens: 500,
      },
    })

    const { result } = renderHook(() => useConversationSettings())
    expect(result.current.settings).toEqual({
      modelId: 'gpt-3',
      providerId: '',
      temperature: 0.5,
      maxOutputTokens: 500,
      compaction: defaultCompaction,
    })
    expect(result.current.conversationInstructions).toBe('')
  })

  it('保留合法的 temperature 0', () => {
    vi.mocked(useMessagesStore).mockReturnValue('conv-zero')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'conv-zero',
      title: 'Test Conversation',
      conversationInstructions: '保持简洁',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-3',
        providerId: '',
        temperature: 0,
        maxOutputTokens: 500,
      },
    })

    const { result } = renderHook(() => useConversationSettings())

    expect(result.current.settings.temperature).toBe(0)
    expect(result.current.conversationInstructions).toBe('保持简洁')
  })

  it('输入会话指令时立即更新本地值，提交时再持久化顶层字段', async () => {
    vi.mocked(useMessagesStore).mockReturnValue('conv-instructions')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'conv-instructions',
      title: 'Test Conversation',
      conversationInstructions: '旧指令',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-3',
        providerId: '',
        temperature: 0.5,
        maxOutputTokens: 500,
      },
    })

    const { result } = renderHook(() => useConversationSettings())
    act(() => {
      result.current.setConversationInstructions('新指令')
    })

    expect(result.current.conversationInstructions).toBe('新指令')
    expect(updateConversationInstructionsAction).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.updateConversationInstructions('新指令')
    })

    expect(updateConversationInstructionsAction).toHaveBeenCalledWith('conv-instructions', '新指令')
  })

  it('连续持久化会话指令时保持请求顺序', async () => {
    vi.mocked(useMessagesStore).mockReturnValue('conv-instructions')
    const conversation = {
      id: 'conv-instructions',
      title: 'Test Conversation',
      conversationInstructions: '旧指令',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-3',
        providerId: '',
        temperature: 0.5,
        maxOutputTokens: 500,
      },
    }
    vi.mocked(getConversationByIdAction).mockReturnValue(conversation)
    let resolveFirst!: (value: typeof conversation) => void
    vi.mocked(updateConversationInstructionsAction)
      .mockImplementationOnce(() => new Promise<typeof conversation>((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce({ ...conversation, conversationInstructions: '第二版' })

    const { result } = renderHook(() => useConversationSettings())
    let firstSave!: Promise<void>
    let secondSave!: Promise<void>
    await act(async () => {
      firstSave = result.current.updateConversationInstructions('第一版')
      secondSave = result.current.updateConversationInstructions('第二版')
      await Promise.resolve()
    })

    expect(updateConversationInstructionsAction).toHaveBeenCalledTimes(1)
    expect(updateConversationInstructionsAction).toHaveBeenNthCalledWith(1, 'conv-instructions', '第一版')

    await act(async () => {
      resolveFirst({ ...conversation, conversationInstructions: '第一版' })
      await Promise.all([firstSave, secondSave])
    })

    expect(updateConversationInstructionsAction).toHaveBeenNthCalledWith(2, 'conv-instructions', '第二版')
    expect(result.current.conversationInstructions).toBe('第二版')
  })

  it('should update settings and call updateConversationsSettingsAction', async () => {
    vi.mocked(useMessagesStore).mockReturnValue('conv3')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'conv3',
      title: 'Test Conversation',
      conversationInstructions: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-3',
        providerId: '',
        temperature: 0.5,
        maxOutputTokens: 500,
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
    expect(result.current.settings.maxOutputTokens).toBe(500)
  })

  it('should persist the compaction token retention target', async () => {
    vi.mocked(useMessagesStore).mockReturnValue('conv3')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'conv3',
      title: 'Test Conversation',
      conversationInstructions: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-3',
        providerId: '',
        temperature: 0.7,
        maxOutputTokens: 4096,
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
          conversationInstructions: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          settings: {
            modelId: 'gpt-3',
            providerId: '',
            temperature: 0.6,
            maxOutputTokens: 800,
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
      temperature: 0.7,
      maxOutputTokens: 1000,
      compaction: defaultCompaction,
    })
  })
})
