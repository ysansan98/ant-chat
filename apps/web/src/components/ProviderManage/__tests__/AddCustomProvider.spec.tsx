import type { CreateProviderConfigSchema } from '@ant-chat/shared'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddCustomProvider } from '../AddCustomProvider'

const { getModelsDevProviders } = vi.hoisted(() => ({
  getModelsDevProviders: vi.fn(),
}))

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    getModelsDevProviders,
  },
}))

async function selectOption(triggerName: string, optionName: string) {
  await userEvent.click(screen.getByRole('combobox', { name: triggerName }))
  await userEvent.click(await screen.findByRole('option', { name: optionName }))
}

// 列表底部按钮与对话框提交按钮均为「添加」；打开前页面只有外层按钮，
// 打开后需在 dialog 范围内定位提交按钮以消除歧义。
async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: '添加' }))
  await screen.findByRole('dialog', { name: '添加自定义提供商' })
}

async function submitForm() {
  await userEvent.click(within(screen.getByRole('dialog', { name: '添加自定义提供商' })).getByRole('button', { name: '添加' }))
}

describe('addCustomProvider 添加表单', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getModelsDevProviders.mockResolvedValue([
      {
        id: 'anthropic-cloud',
        name: 'Anthropic Cloud',
        apiMode: 'anthropic',
        baseUrl: 'https://api.anthropic.example',
      },
    ])
  })

  it('从 Models.dev 选择后，兼容模式的可见值与将提交的表单状态一致', async () => {
    const onAdd = vi.fn(async (_provider: CreateProviderConfigSchema) => {})
    render(<AddCustomProvider onAdd={onAdd} />)
    await openDialog()

    await selectOption('从 Models.dev 选择', 'Anthropic Cloud (anthropic-cloud)')

    expect(screen.getByRole('combobox', { name: 'API 模式 *' })).toHaveTextContent('Anthropic 兼容')
    expect(screen.getByLabelText('API 地址 *')).toHaveValue('https://api.anthropic.example')
    await userEvent.type(screen.getByLabelText('API Key *'), 'anthropic-key')
    await submitForm()

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd).toHaveBeenCalledWith({
      id: 'anthropic-cloud',
      name: 'Anthropic Cloud',
      baseUrl: 'https://api.anthropic.example',
      integrationId: 'api-key',
      apiKey: 'anthropic-key',
      apiMode: 'anthropic',
      isEnabled: true,
    })
  })

  it('不展示产品集成选择器，始终按 API Key 集成提交', async () => {
    const onAdd = vi.fn(async (_provider: CreateProviderConfigSchema) => {})
    render(<AddCustomProvider onAdd={onAdd} />)
    await openDialog()

    expect(screen.queryByRole('combobox', { name: '产品集成 *' })).not.toBeInTheDocument()
    // API Key 认证的表单字段固定展示
    expect(screen.getByLabelText('API 地址 *')).toBeInTheDocument()
    expect(screen.getByLabelText('API Key *')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('提供商名称 *'), '我的服务商')
    await userEvent.type(screen.getByLabelText('API 地址 *'), 'https://api.example.com')
    await userEvent.type(screen.getByLabelText('API Key *'), 'my-key')
    await submitForm()

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      name: '我的服务商',
      baseUrl: 'https://api.example.com',
      integrationId: 'api-key',
      apiMode: 'openai',
      apiKey: 'my-key',
      isEnabled: true,
    }))
  })

  it('取消后重新打开时，所有 Select 和输入框恢复同一组默认值', async () => {
    render(<AddCustomProvider onAdd={vi.fn()} />)
    await openDialog()
    await userEvent.type(screen.getByLabelText('提供商名称 *'), '临时服务商')

    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    await openDialog()

    expect(screen.getByRole('combobox', { name: 'API 模式 *' })).toHaveTextContent('OpenAI 兼容')
    expect(screen.getByRole('combobox', { name: '从 Models.dev 选择' })).toHaveTextContent('选择服务商')
    expect(screen.getByLabelText('提供商名称 *')).toHaveValue('')
    expect(screen.getByLabelText('API 地址 *')).toHaveValue('')
    expect(screen.getByLabelText('API Key *')).toBeInTheDocument()
  })
})
