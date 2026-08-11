import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectVisionModel } from '../SelectVisionModel'

const { getAllAbvailableModels, updateSettings } = vi.hoisted(() => ({
  getAllAbvailableModels: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    getAllAbvailableModels,
  },
}))

vi.mock('@/store/generalSettings/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/generalSettings/actions')>()
  return {
    ...actual,
    setVisionModel: vi.fn(async (modelId: string, providerId: string) => {
      updateSettings({ visionModelId: modelId, visionProviderId: providerId })
    }),
  }
})

vi.mock('@/api/generalSettingsApi', () => ({
  generalSettingsApi: {
    updateSettings,
    getSettings: vi.fn(),
    resetSettings: vi.fn(),
  },
}))

vi.mock('@/api/transports/appRpc', () => ({
  getAppRuntimeCapabilities: () => ({ nativeWindow: false, autoUpdate: false, nativeFilePicker: false }),
}))

describe('selectVisionModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAllAbvailableModels.mockResolvedValue([{
      id: 'provider-1',
      name: 'Provider 1',
      models: [
        {
          id: 'vision-model',
          name: 'Vision Model',
          providerId: 'provider-1',
          maxOutputTokens: 4096,
          temperature: 0.7,
          capabilities: { inputModalities: ['text', 'image'] },
        },
        {
          id: 'text-model',
          name: 'Text Only',
          providerId: 'provider-1',
          maxOutputTokens: 4096,
          temperature: 0.7,
          capabilities: { inputModalities: ['text'] },
        },
      ],
    }])
  })

  it('只展示支持图片输入的模型，选择后保存视觉模型', async () => {
    render(<SelectVisionModel />)

    fireEvent.click(await screen.findByText('未设置'))
    fireEvent.click(await screen.findByText('Provider 1'))

    expect(screen.queryByText('Text Only')).toBeNull()
    fireEvent.click(await screen.findByText('Vision Model'))

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      visionModelId: 'vision-model',
      visionProviderId: 'provider-1',
    }))
  })
})
