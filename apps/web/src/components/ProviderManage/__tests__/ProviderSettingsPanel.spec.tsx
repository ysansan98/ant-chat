import type { ProviderAuthStatus, ProviderPublicView, ProviderUsageStatus } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProviderSettingsPanel } from '../ProviderSettingsPanel'

const { getAuthStatus, getUsage, listProviderModels } = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getUsage: vi.fn(),
  listProviderModels: vi.fn(),
}))

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    getAuthStatus,
    getUsage,
    listProviderModels,
    startOAuthLogin: vi.fn(),
    importLocalAuth: vi.fn(),
    logoutAuth: vi.fn(),
    syncModels: vi.fn(),
    deleteProviderModel: vi.fn(),
    setModelEnabledStatus: vi.fn(),
    createProviderModel: vi.fn(),
  },
}))

function apiKeyProvider(id: string, extra?: Partial<ProviderPublicView>): ProviderPublicView {
  return {
    id,
    name: id,
    baseUrl: 'https://api.example.com',
    apiMode: 'openai',
    integrationId: 'api-key',
    capabilities: {
      authentication: 'api-key',
      modelSource: 'models-dev',
      localAuthImport: false,
      usage: 'none',
      endpoint: 'custom',
    },
    isOfficial: false,
    isEnabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  }
}

function oauthProvider(id: string): ProviderPublicView {
  return apiKeyProvider(id, {
    integrationId: 'codex-subscription',
    capabilities: {
      authentication: 'oauth',
      modelSource: 'provider',
      localAuthImport: true,
      usage: 'quota',
      endpoint: 'fixed',
      fixedBaseUrl: 'https://chatgpt.com/backend-api/codex',
    },
  })
}

describe('providerSettingsPanel 状态隔离', () => {
  it('fixed endpoint 提供者（如 Codex 订阅）不展示 API URL 输入框', async () => {
    listProviderModels.mockResolvedValue([])
    getAuthStatus.mockResolvedValue({ authenticated: false, state: 'missing' } satisfies ProviderAuthStatus)
    render(<ProviderSettingsPanel item={oauthProvider('provider-a')} />)
    await screen.findByText(/未登录/)
    expect(screen.queryByLabelText('API URL')).not.toBeInTheDocument()
  })

  it('custom endpoint 提供者展示可编辑的 API URL 输入框', () => {
    listProviderModels.mockResolvedValue([])
    render(<ProviderSettingsPanel item={apiKeyProvider('provider-a')} />)
    expect(screen.getByLabelText('API URL')).toBeInTheDocument()
    expect(screen.getByLabelText('API URL')).toHaveValue('https://api.example.com')
  })

  it('切换 API-Key Provider 时清空上一个 Provider 的 Key 草稿', async () => {
    listProviderModels.mockResolvedValue([])
    const onChange = vi.fn()
    const providerA = apiKeyProvider('provider-a')
    const providerB = apiKeyProvider('provider-b')

    const { rerender } = render(<ProviderSettingsPanel item={providerA} onChange={onChange} />)
    const keyInput = screen.getByLabelText('API Key')
    fireEvent.change(keyInput, { target: { value: 'secret-for-a' } })
    expect(keyInput).toHaveValue('secret-for-a')

    rerender(<ProviderSettingsPanel item={providerB} onChange={onChange} />)
    const keyInputB = screen.getByLabelText('API Key')
    expect(keyInputB).toHaveValue('')

    fireEvent.blur(keyInputB)
    // A 的 Key 草稿不得通过 blur 写入 B。
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'provider-b', apiKey: 'secret-for-a' }))
  })

  it('切换 OAuth Provider 时重置登录状态与额度显示', async () => {
    listProviderModels.mockResolvedValue([])
    getAuthStatus.mockResolvedValue({ authenticated: true, state: 'usable', planType: 'plus', accountId: 'a-1' } satisfies ProviderAuthStatus)
    getUsage.mockResolvedValue({
      planType: 'plus',
      primaryWindow: { usedPercent: 50, limitWindowSeconds: 3600, resetAfterSeconds: 120, resetAt: 2_000 },
    } satisfies ProviderUsageStatus)
    const providerA = oauthProvider('provider-a')
    const providerB = oauthProvider('provider-b')

    const { rerender } = render(<ProviderSettingsPanel key={providerA.id} item={providerA} />)
    await screen.findByText(/已登录.*plus/)
    fireEvent.click(screen.getByText('刷新额度'))
    await screen.findByText('当前窗口用量')
    expect(screen.getByText('当前窗口用量')).toBeInTheDocument()

    getAuthStatus.mockResolvedValue({ authenticated: false, state: 'missing' } satisfies ProviderAuthStatus)
    rerender(<ProviderSettingsPanel key={providerB.id} item={providerB} />)

    await waitFor(() => expect(screen.getByText(/未登录/)).toBeInTheDocument())
    // A 的额度与账号信息不得串显到 B。
    expect(screen.queryByText('当前窗口用量')).not.toBeInTheDocument()
    expect(screen.queryByText(/a-1/)).not.toBeInTheDocument()
  })
})
