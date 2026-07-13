import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatSettingsContext, DEFAULT_SETTINGS } from '@/contexts/chatSettings'
import { ModelParameterSettingsPanel } from '../ModelParameterSettingsPanel'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    getModelInfoById: vi.fn(async () => ({
      id: 'model-1',
      model: 'model-1',
      name: 'Model 1',
      providerId: 'provider-1',
      contextLength: 128_000,
      maxOutputTokens: 8192,
    })),
  },
}))

describe('modelParameterSettingsPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the configurable token retention target and boundary explanation', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    render(
      <ChatSettingsContext
        value={{
          settings: {
            ...DEFAULT_SETTINGS,
            modelId: 'model-1',
            compaction: {
              enabled: true,
              thresholdPercent: 70,
              keepRecentTokens: 20_000,
            },
          },
          conversationInstructions: '',
          setConversationInstructions: vi.fn(),
          updateConversationInstructions: vi.fn(),
          updateSettings: vi.fn(),
        }}
      >
        <ModelParameterSettingsPanel />
      </ChatSettingsContext>,
    )

    expect(screen.getByText('20k Token')).toBeDefined()
    expect(screen.getByText(/实际保留的上下文可能略多/)).toBeDefined()
  })

  it('单独展示并更新会话指令', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    const setConversationInstructions = vi.fn()
    const updateConversationInstructions = vi.fn()

    render(
      <ChatSettingsContext
        value={{
          settings: DEFAULT_SETTINGS,
          conversationInstructions: '使用中文回答',
          setConversationInstructions,
          updateConversationInstructions,
          updateSettings: vi.fn(),
        }}
      >
        <ModelParameterSettingsPanel />
      </ChatSettingsContext>,
    )

    expect(screen.getByRole('heading', { name: '会话指令' })).toBeDefined()
    const input = screen.getByLabelText('会话指令')
    expect(input).toHaveValue('使用中文回答')

    fireEvent.change(input, { target: { value: '保持简洁' } })
    expect(setConversationInstructions).toHaveBeenCalledWith('保持简洁')
    expect(updateConversationInstructions).not.toHaveBeenCalled()

    fireEvent.blur(input, { target: { value: '保持简洁' } })
    expect(updateConversationInstructions).toHaveBeenCalledWith('保持简洁')
  })
})
