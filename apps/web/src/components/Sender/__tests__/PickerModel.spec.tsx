import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    }, 'fallback'))
  })

  it('切换到不支持当前档位的模型时清除旧推理强度', async () => {
    getAllAbvailableModels.mockResolvedValueOnce([{
      id: 'provider-1',
      name: 'Provider 1',
      models: [
        {
          id: 'model-1',
          name: 'Model 1',
          providerId: 'provider-1',
          maxOutputTokens: 4096,
          temperature: 0.7,
          capabilities: { reasoningLevels: ['low', 'high'] },
        },
        {
          id: 'model-2',
          name: 'Model 2',
          providerId: 'provider-1',
          maxOutputTokens: 4096,
          temperature: 0.7,
          capabilities: { reasoningLevels: ['low'] },
        },
      ],
    }])
    const onChange = vi.fn()
    const onReasoningEffortChange = vi.fn()

    render(
      <ModelControlPanel
        value={{ modelId: 'model-1', providerId: 'provider-1' }}
        onChange={onChange}
        reasoningEffort="high"
        onReasoningEffortChange={onReasoningEffortChange}
      />,
    )

    const trigger = await screen.findByRole('button')
    fireEvent.click(trigger)
    const providerItem = await screen.findByText('Provider 1')
    providerItem.focus()
    fireEvent.keyDown(providerItem, { key: 'ArrowRight' })
    fireEvent.click(await screen.findByText('Model 2'))

    expect(onReasoningEffortChange).toHaveBeenCalledWith(undefined)
    expect(onChange).toHaveBeenCalledWith({
      modelId: 'model-2',
      providerId: 'provider-1',
    }, 'user')
  })

  it('从当前模型目录选择推理强度后回调实际档位', async () => {
    getAllAbvailableModels.mockResolvedValueOnce([{
      id: 'provider-1',
      name: 'Provider 1',
      models: [{
        id: 'model-1',
        name: 'Model 1',
        providerId: 'provider-1',
        maxOutputTokens: 4096,
        temperature: 0.7,
        capabilities: { reasoningLevels: ['low', 'medium', 'high', 'xhigh'] },
      }],
    }])
    const onReasoningEffortChange = vi.fn()

    render(
      <ModelControlPanel
        value={{ modelId: 'model-1', providerId: 'provider-1' }}
        reasoningEffort={undefined}
        onReasoningEffortChange={onReasoningEffortChange}
      />,
    )

    fireEvent.click(await screen.findByRole('button'))
    fireEvent.click(await screen.findByText('极高'))

    expect(onReasoningEffortChange).toHaveBeenCalledWith('xhigh')
  })
})
