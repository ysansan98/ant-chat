import type { CreateProviderConfigSchema } from '@ant-chat/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddCustomProvider } from '../AddCustomProvider'

const { getModelsDevProviders, listIntegrations } = vi.hoisted(() => ({
  getModelsDevProviders: vi.fn(),
  listIntegrations: vi.fn(),
}))

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    getModelsDevProviders,
    listIntegrations,
  },
}))

async function selectOption(triggerName: string, optionName: string) {
  await userEvent.click(screen.getByRole('combobox', { name: triggerName }))
  await userEvent.click(await screen.findByRole('option', { name: optionName }))
}

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: '添加自定义提供商' }))
  await screen.findByRole('dialog', { name: '添加自定义提供商' })
}

describe('addCustomProvider 产品集成表单', () => {
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
    listIntegrations.mockResolvedValue([
      {
        id: 'api-key',
        label: 'API Key',
        authentication: 'api-key',
        defaultApiMode: 'openai',
      },
      {
        id: 'codex-subscription',
        label: 'Codex 订阅',
        authentication: 'oauth',
        defaultApiMode: 'openai',
        fixedApiMode: 'openai',
        fixedBaseUrl: 'https://chatgpt.com/backend-api/codex',
      },
    ])
  })

  it('从 Models.dev 选择后，兼容模式的可见值与将提交的表单状态一致', async () => {
    const onAdd = vi.fn(async (_provider: CreateProviderConfigSchema) => {})
    render(<AddCustomProvider onAdd={onAdd} />)
    await openDialog()

    await selectOption('从 Models.dev 选择', 'Anthropic Cloud (anthropic-cloud)')

    expect(screen.getByRole('combobox', { name: 'API 模式 *' })).toHaveTextContent('Anthropic 兼容')
    expect(screen.getByRole('combobox', { name: '产品集成 *' })).toHaveTextContent('API Key')
    expect(screen.getByLabelText('API 地址 *')).toHaveValue('https://api.anthropic.example')
    await userEvent.type(screen.getByLabelText('API Key *'), 'anthropic-key')
    await userEvent.click(screen.getByRole('button', { name: '添加' }))

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

  it('切到 Codex 后清除 Models.dev 来源，并提交 descriptor 规范化后的配置', async () => {
    const onAdd = vi.fn(async (_provider: CreateProviderConfigSchema) => {})
    render(<AddCustomProvider onAdd={onAdd} />)
    await openDialog()
    await selectOption('从 Models.dev 选择', 'Anthropic Cloud (anthropic-cloud)')

    await selectOption('产品集成 *', 'Codex 订阅')

    expect(screen.getByRole('combobox', { name: '从 Models.dev 选择' })).toHaveTextContent('选择服务商')
    expect(screen.getByRole('combobox', { name: 'API 模式 *' })).toHaveTextContent('OpenAI 兼容')
    // fixed endpoint（Codex 订阅）不展示 API 地址输入框，提交时由 descriptor 提供。
    expect(screen.queryByLabelText('API 地址 *')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('API Key *')).not.toBeInTheDocument()

    const nameInput = screen.getByLabelText('提供商名称 *')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '我的 Codex')
    await userEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      name: '我的 Codex',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      integrationId: 'codex-subscription',
      apiMode: 'openai',
      isEnabled: true,
    }))
    const payload = onAdd.mock.calls[0][0]
    expect(payload.id).not.toBe('anthropic-cloud')
    expect(payload).not.toHaveProperty('apiKey')
  })

  it('取消后重新打开时，所有 Select 和输入框恢复同一组默认值', async () => {
    render(<AddCustomProvider onAdd={vi.fn()} />)
    await openDialog()
    await selectOption('产品集成 *', 'Codex 订阅')
    await userEvent.type(screen.getByLabelText('提供商名称 *'), '临时 Codex')

    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    await openDialog()

    expect(screen.getByRole('combobox', { name: '产品集成 *' })).toHaveTextContent('API Key')
    expect(screen.getByRole('combobox', { name: 'API 模式 *' })).toHaveTextContent('OpenAI 兼容')
    expect(screen.getByRole('combobox', { name: '从 Models.dev 选择' })).toHaveTextContent('选择服务商')
    expect(screen.getByLabelText('提供商名称 *')).toHaveValue('')
    expect(screen.getByLabelText('API 地址 *')).toHaveValue('')
    expect(screen.getByLabelText('API Key *')).toBeInTheDocument()
  })
})
