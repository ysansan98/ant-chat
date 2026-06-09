import { render, screen } from '@testing-library/react'
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
      maxTokens: 8192,
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
          updateSettings: vi.fn(),
        }}
      >
        <ModelParameterSettingsPanel />
      </ChatSettingsContext>,
    )

    expect(screen.getByText('20k tokens')).toBeDefined()
    expect(screen.getByText(/actual retained context may be slightly larger/i)).toBeDefined()
  })
})
