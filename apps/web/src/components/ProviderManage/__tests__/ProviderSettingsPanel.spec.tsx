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
    setModelsEnabledStatus: vi.fn(),
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

    // A 的草稿被丢弃：B 上的保存入口消失，也没有任何提交。
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('占位符明确区分 API Key 已配置与未配置，且不回显明文', () => {
    listProviderModels.mockResolvedValue([])
    const { rerender } = render(<ProviderSettingsPanel item={apiKeyProvider('provider-a', { hasApiKey: true })} />)
    expect(screen.getByLabelText('API Key')).toHaveAttribute('placeholder', '已配置，输入新 Key 可替换')
    // 不再提供"显示密码"入口，输入始终掩码。
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password')

    rerender(<ProviderSettingsPanel item={apiKeyProvider('provider-a')} />)
    expect(screen.getByLabelText('API Key')).toHaveAttribute('placeholder', '未配置')
  })

  it('只聚焦不输入时，API Key 输入框失焦不提交空密钥', () => {
    listProviderModels.mockResolvedValue([])
    const onChange = vi.fn()
    render(<ProviderSettingsPanel item={apiKeyProvider('provider-a', { hasApiKey: true })} onChange={onChange} />)

    const keyInput = screen.getByLabelText('API Key')
    fireEvent.focus(keyInput)
    fireEvent.blur(keyInput)

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
  })

  it('输入过程中失焦不落盘，点击保存才提交新密钥', async () => {
    listProviderModels.mockResolvedValue([])
    const onChange = vi.fn<() => Promise<void>>(async () => {})
    render(<ProviderSettingsPanel item={apiKeyProvider('provider-a', { hasApiKey: true })} onChange={onChange} />)

    const keyInput = screen.getByLabelText('API Key')
    fireEvent.change(keyInput, { target: { value: 'new-secret' } })
    fireEvent.blur(keyInput)

    // 输入后失焦只是草稿，不写任何配置。
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider-a', apiKey: 'new-secret' })))
    // 保存成功后草稿清空，保存入口隐藏。
    expect(screen.getByLabelText('API Key')).toHaveValue('')
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
  })

  it('点击取消丢弃草稿且不提交', () => {
    listProviderModels.mockResolvedValue([])
    const onChange = vi.fn()
    render(<ProviderSettingsPanel item={apiKeyProvider('provider-a', { hasApiKey: true })} onChange={onChange} />)

    const keyInput = screen.getByLabelText('API Key')
    fireEvent.change(keyInput, { target: { value: 'half-typed' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('API Key')).toHaveValue('')
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
  })

  it('回车保存、Esc 取消', async () => {
    listProviderModels.mockResolvedValue([])
    const onChange = vi.fn<() => Promise<void>>(async () => {})
    render(<ProviderSettingsPanel item={apiKeyProvider('provider-a', { hasApiKey: true })} onChange={onChange} />)

    const keyInput = screen.getByLabelText('API Key')
    fireEvent.change(keyInput, { target: { value: 'typed-then-esc' } })
    fireEvent.keyDown(keyInput, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(keyInput).toHaveValue('')

    fireEvent.change(keyInput, { target: { value: 'typed-then-enter' } })
    fireEvent.keyDown(keyInput, { key: 'Enter' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider-a', apiKey: 'typed-then-enter' })))
  })

  it('已配置密钥时清空草稿后按钮显示清除密钥，并提交空值', async () => {
    listProviderModels.mockResolvedValue([])
    const onChange = vi.fn<() => Promise<void>>(async () => {})
    render(<ProviderSettingsPanel item={apiKeyProvider('provider-a', { hasApiKey: true })} onChange={onChange} />)

    const keyInput = screen.getByLabelText('API Key')
    fireEvent.change(keyInput, { target: { value: 'draft-secret' } })
    fireEvent.change(keyInput, { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: '清除密钥' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider-a', apiKey: '' })))
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
