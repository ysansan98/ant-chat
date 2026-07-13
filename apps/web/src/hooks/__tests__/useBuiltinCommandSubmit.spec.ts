import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessagesStore } from '@/store/messages'
import { useBuiltinCommandSubmit } from '../useBuiltinCommandSubmit'

const mocks = vi.hoisted(() => ({
  runBuiltinCommand: vi.fn(),
  upsertConversationAction: vi.fn(),
}))

vi.mock('@/api/commandsApi', () => ({
  default: {
    cancelCommand: vi.fn(),
    runBuiltinCommand: mocks.runBuiltinCommand,
  },
}))

vi.mock('@/store/conversation', () => ({
  upsertConversationAction: mocks.upsertConversationAction,
}))

describe('useBuiltinCommandSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMessagesStore.setState({ activeConversationsId: '', messages: [] })
    mocks.runBuiltinCommand.mockResolvedValue({ status: 'success' })
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(600)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('/new 保留 temperature 0 并发送当前会话指令', async () => {
    const { result } = renderHook(() => useBuiltinCommandSubmit({
      settings: {
        modelId: 'model-1',
        providerId: 'provider-1',
        temperature: 0,
        maxOutputTokens: 2048,
      },
      conversationInstructions: '使用中文回答',
      currentWorkspacePath: '/workspace',
    }))

    await act(async () => {
      await result.current.submitCommand('/new')
    })

    expect(mocks.runBuiltinCommand).toHaveBeenCalledWith({
      id: 'new',
      conversationId: undefined,
      argument: undefined,
      conversationInstructions: '使用中文回答',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        temperature: 0,
        maxOutputTokens: 2048,
        reasoningEffort: undefined,
      },
      workspacePath: '/workspace',
    })
  })
})
