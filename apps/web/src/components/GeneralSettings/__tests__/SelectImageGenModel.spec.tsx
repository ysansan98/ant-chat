import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectImageGenModel } from '../SelectImageGenModel'

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
    setImageGenModel: vi.fn(async (modelId: string, providerId: string) => {
      updateSettings({ imageGenModelId: modelId, imageGenProviderId: providerId })
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

describe('selectImageGenModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAllAbvailableModels.mockResolvedValue([{
      id: 'provider-1',
      name: 'Provider 1',
      models: [
        {
          id: 'image-model',
          name: 'Image Gen Model',
          providerId: 'provider-1',
          maxOutputTokens: 4096,
          temperature: 0.7,
          capabilities: { outputModalities: ['image'] },
        },
        {
          id: 'text-model',
          name: 'Text Only',
          providerId: 'provider-1',
          maxOutputTokens: 4096,
          temperature: 0.7,
          capabilities: { outputModalities: ['text'] },
        },
      ],
    }])
  })

  it('只展示支持图片输出的模型，选择后保存图像生成模型', async () => {
    render(<SelectImageGenModel />)

    fireEvent.click(await screen.findByText('未设置'))
    fireEvent.click(await screen.findByText('Provider 1'))

    expect(screen.queryByText('Text Only')).toBeNull()
    fireEvent.click(await screen.findByText('Image Gen Model'))

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      imageGenModelId: 'image-model',
      imageGenProviderId: 'provider-1',
    }))
  })
})
