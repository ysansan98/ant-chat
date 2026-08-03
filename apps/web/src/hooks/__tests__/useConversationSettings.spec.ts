/* eslint-disable import/first */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationSettings } from '../useConversationSettings'

const { mockGeneralSettingsState } = vi.hoisted(() => ({
  mockGeneralSettingsState: {
    defaultModelId: '',
    defaultProviderId: '',
  },
}))

// Mock dependencies
vi.mock('@/store/conversation', () => ({
  getConversationByIdAction: vi.fn(),
  updateConversationInstructionsAction: vi.fn().mockResolvedValue(undefined),
  updateConversationsSettingsAction: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/store/messages', () => ({
  useMessagesStore: vi.fn(),
}))

vi.mock('@/store/generalSettings', () => ({
  useGeneralSettingsStore: (selector: (state: typeof mockGeneralSettingsState) => unknown) =>
    selector(mockGeneralSettingsState),
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
    Object.assign(mockGeneralSettingsState, { defaultModelId: '', defaultProviderId: '' })
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

  it('新建会话优先使用最近使用模型', () => {
    vi.mocked(useMessagesStore).mockReturnValue('')
    vi.mocked(getConversationByIdAction).mockReturnValue(undefined)
    Object.assign(mockGeneralSettingsState, { defaultModelId: 'last-model', defaultProviderId: 'last-provider' })

    const { result } = renderHook(() => useConversationSettings())

    expect(result.current.settings).toMatchObject({
      modelId: 'last-model',
      providerId: 'last-provider',
    })
  })

  it('已有会话模型优先于最近使用模型，空旧设置才回退', () => {
    vi.mocked(useMessagesStore).mockReturnValue('legacy-conversation')
    Object.assign(mockGeneralSettingsState, { defaultModelId: 'last-model', defaultProviderId: 'last-provider' })
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'legacy-conversation',
      title: 'Legacy',
      conversationInstructions: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: '',
        providerId: '',
        temperature: 0.7,
        maxOutputTokens: 1000,
      },
    })

    const { result } = renderHook(() => useConversationSettings())

    expect(result.current.settings).toMatchObject({
      modelId: 'last-model',
      providerId: 'last-provider',
    })
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

  it('新会话且未记住默认模型时，起始模型为空（交由 PickerModel 兜底到列表第一个）', () => {
    mockGeneralSettingsState.defaultModelId = ''
    mockGeneralSettingsState.defaultProviderId = ''
    vi.mocked(useMessagesStore).mockReturnValue(() => 'new-conv')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'new-conv',
      title: 'New',
      conversationInstructions: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: '',
        providerId: '',
        temperature: 0.7,
        maxOutputTokens: 1000,
      },
    })

    const { result } = renderHook(() => useConversationSettings())
    expect(result.current.settings.modelId).toBe('')
    expect(result.current.settings.providerId).toBe('')
  })

  it('新会话使用记住的默认模型作为起始模型', () => {
    mockGeneralSettingsState.defaultModelId = 'claude-opus'
    mockGeneralSettingsState.defaultProviderId = 'anthropic'
    vi.mocked(useMessagesStore).mockReturnValue(() => 'new-conv-2')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'new-conv-2',
      title: 'New 2',
      conversationInstructions: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: '',
        providerId: '',
        temperature: 0.7,
        maxOutputTokens: 1000,
      },
    })

    const { result } = renderHook(() => useConversationSettings())
    expect(result.current.settings.modelId).toBe('claude-opus')
    expect(result.current.settings.providerId).toBe('anthropic')
  })

  it('已存模型的会话优先使用会话自身模型，不受默认模型影响', () => {
    mockGeneralSettingsState.defaultModelId = 'claude-opus'
    mockGeneralSettingsState.defaultProviderId = 'anthropic'
    vi.mocked(useMessagesStore).mockReturnValue(() => 'conv-stored')
    vi.mocked(getConversationByIdAction).mockReturnValue({
      id: 'conv-stored',
      title: 'Stored',
      conversationInstructions: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        modelId: 'gpt-4',
        providerId: 'openai',
        temperature: 0.7,
        maxOutputTokens: 1000,
      },
    })

    const { result } = renderHook(() => useConversationSettings())
    expect(result.current.settings.modelId).toBe('gpt-4')
    expect(result.current.settings.providerId).toBe('openai')
  })

  it('切换到无模型的会话时重新按默认模型播种', () => {
    mockGeneralSettingsState.defaultModelId = 'claude-opus'
    mockGeneralSettingsState.defaultProviderId = 'anthropic'
    let activeId = 'conv-has-model'
    vi.mocked(useMessagesStore).mockImplementation(cb => cb({
      activeConversationsId: activeId,
      messages: [],
      pendingSteeringByConversation: {},
      reset(): void {
        throw new Error('Function not implemented.')
      },
    }))
    vi.mocked(getConversationByIdAction).mockImplementation((id) => {
      if (id === 'conv-has-model') {
        return {
          id: 'conv-has-model',
          title: 'Has Model',
          conversationInstructions: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          settings: {
            modelId: 'gpt-4',
            providerId: 'openai',
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
        }
      }
      return undefined
    })

    const { result, rerender } = renderHook(() => useConversationSettings())
    expect(result.current.settings.modelId).toBe('gpt-4')

    activeId = 'conv-no-model'
    rerender()
    expect(result.current.settings.modelId).toBe('claude-opus')
    expect(result.current.settings.providerId).toBe('anthropic')
  })
})
