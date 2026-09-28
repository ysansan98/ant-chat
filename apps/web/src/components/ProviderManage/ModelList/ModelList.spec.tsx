import type { ProviderConfigModelSchema } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelList } from './ModelList'

const { deleteProviderModel, listProviderModels, setModelEnabledStatus, setModelsEnabledStatus } = vi.hoisted(() => ({
  deleteProviderModel: vi.fn(async () => null),
  listProviderModels: vi.fn(async (): Promise<ProviderConfigModelSchema[]> => []),
  setModelEnabledStatus: vi.fn(async () => null),
  setModelsEnabledStatus: vi.fn(async () => []),
}))

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    createProviderModel: vi.fn(),
    deleteProviderModel,
    listProviderModels,
    setModelEnabledStatus,
    setModelsEnabledStatus,
    syncModels: vi.fn(async () => []),
  },
}))

function createModel(overrides: Partial<ProviderConfigModelSchema> & Pick<ProviderConfigModelSchema, 'id' | 'name'>): ProviderConfigModelSchema {
  return {
    model: overrides.id,
    providerId: 'provider-a',
    isEnabled: true,
    isBuiltin: false,
    maxOutputTokens: 4096,
    contextLength: 8192,
    temperature: 0.7,
    createdAt: 0,
    ...overrides,
  }
}

describe('modelList 列表操作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('启停和删除模型时同时提交 Provider ID 与模型 ID', async () => {
    listProviderModels.mockResolvedValue([createModel({ id: 'shared-model', name: 'Shared Model' })])
    render(<ModelList providerId="provider-a" />)
    await screen.findByText('Shared Model')

    fireEvent.click(screen.getByRole('switch', { name: '启用模型：Shared Model' }))
    await waitFor(() => expect(setModelEnabledStatus).toHaveBeenCalledWith('provider-a', 'shared-model', false))

    fireEvent.click(screen.getByRole('button', { name: '删除 Shared Model' }))
    await waitFor(() => expect(deleteProviderModel).toHaveBeenCalledWith('provider-a', 'shared-model'))
  })

  it('按模型名称或模型 ID 过滤列表', async () => {
    listProviderModels.mockResolvedValue([
      createModel({ id: 'gpt-5', name: 'GPT-5' }),
      createModel({ id: 'claude-sonnet', name: 'Claude Sonnet' }),
      createModel({ id: 'deepseek-chat', name: 'DeepSeek Chat' }),
    ])
    render(<ModelList providerId="provider-a" />)
    await screen.findByText('GPT-5')

    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'claude' } })
    expect(screen.getByText('Claude Sonnet')).toBeInTheDocument()
    expect(screen.queryByText('GPT-5')).not.toBeInTheDocument()
    expect(screen.queryByText('DeepSeek Chat')).not.toBeInTheDocument()

    // 名称不匹配但模型 ID 命中时同样保留。
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'gpt-5' } })
    expect(screen.getByText('GPT-5')).toBeInTheDocument()
    expect(screen.queryByText('Claude Sonnet')).not.toBeInTheDocument()
  })

  it('全选启用只作用于当前筛选结果', async () => {
    listProviderModels.mockResolvedValue([
      createModel({ id: 'gpt-5', name: 'GPT-5', isEnabled: false }),
      createModel({ id: 'claude-sonnet', name: 'Claude Sonnet', isEnabled: false }),
      createModel({ id: 'deepseek-chat', name: 'DeepSeek Chat', isEnabled: false }),
    ])
    render(<ModelList providerId="provider-a" />)
    await screen.findByText('GPT-5')

    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'claude' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '全部启用' }))

    await waitFor(() => expect(setModelsEnabledStatus).toHaveBeenCalledWith('provider-a', ['claude-sonnet'], true))
  })

  it('全部已启用时取消全选则批量禁用', async () => {
    listProviderModels.mockResolvedValue([
      createModel({ id: 'gpt-5', name: 'GPT-5' }),
      createModel({ id: 'claude-sonnet', name: 'Claude Sonnet' }),
    ])
    render(<ModelList providerId="provider-a" />)
    await screen.findByText('GPT-5')

    const selectAll = screen.getByRole('checkbox', { name: '全部启用' })
    expect(selectAll).toBeChecked()
    fireEvent.click(selectAll)

    await waitFor(() => expect(setModelsEnabledStatus).toHaveBeenCalledWith('provider-a', ['gpt-5', 'claude-sonnet'], false))
  })

  it('行内开关启用已禁用的模型', async () => {
    listProviderModels.mockResolvedValue([createModel({ id: 'shared-model', name: 'Shared Model', isEnabled: false })])
    render(<ModelList providerId="provider-a" />)
    await screen.findByText('Shared Model')

    expect(screen.getByRole('switch', { name: '启用模型：Shared Model' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('switch', { name: '启用模型：Shared Model' }))
    await waitFor(() => expect(setModelEnabledStatus).toHaveBeenCalledWith('provider-a', 'shared-model', true))
  })

  it('在模型名称后展示能力标签', async () => {
    listProviderModels.mockResolvedValue([
      createModel({
        id: 'vision-model',
        name: 'Vision Model',
        capabilities: {
          functionCall: true,
          reasoning: true,
          structuredOutput: true,
          inputModalities: ['text', 'image', 'pdf'],
        },
      }),
    ])
    render(<ModelList providerId="provider-a" />)
    await screen.findByText('Vision Model')

    expect(screen.getByText('工具调用')).toBeInTheDocument()
    expect(screen.getByText('推理')).toBeInTheDocument()
    expect(screen.getByText('图片')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
    // 文本输入是所有模型的默认能力，不生成标签。
    expect(screen.queryByText('文本')).not.toBeInTheDocument()
    // 结构化输出不进入标签列表。
    expect(screen.queryByText('结构化输出')).not.toBeInTheDocument()
  })
})
