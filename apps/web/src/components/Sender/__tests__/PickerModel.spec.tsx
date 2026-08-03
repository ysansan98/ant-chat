import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelControlPanel } from '../PickerModel'

const { getAllAbvailableModels } = vi.hoisted(() => ({
  getAllAbvailableModels: vi.fn(),
}))

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    getAllAbvailableModels,
  },
}))

describe('modelControlPanel', () => {
  it('自动兜底到第一项时标记为 fallback，不更新最近使用模型', async () => {
    getAllAbvailableModels.mockResolvedValueOnce([{
      id: 'provider-1',
      name: 'Provider 1',
      models: [{
        id: 'model-1',
        name: 'Model 1',
        providerId: 'provider-1',
        maxOutputTokens: 4096,
        temperature: 0.7,
      }],
    }])
    const onChange = vi.fn()

    render(<ModelControlPanel value={{ modelId: '', providerId: '' }} onChange={onChange} />)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({
      modelId: 'model-1',
      providerId: 'provider-1',
      maxOutputTokens: 4096,
      temperature: 0.7,
    }, 'fallback'))
  })
})
