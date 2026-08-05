import type { ProviderPublicView } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { providerApi } from '@/api/providerApi'
import ProviderManage from '../ProviderManage'

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    listProviders: vi.fn(),
    updateProvider: vi.fn(),
    createProvider: vi.fn(),
    deleteProvider: vi.fn(),
  },
}))

vi.mock('@/components/ProviderManage/AddCustomProvider', () => ({
  AddCustomProvider: () => null,
}))

vi.mock('@/components/ProviderManage/ProviderSettingsPanel', () => ({
  ProviderSettingsPanel: ({ item, onChange }: { item: ProviderPublicView, onChange: (config: { id: string }) => Promise<void> }) => (
    <div>
      <span data-testid="active-provider-key-state">{item.hasApiKey ? '有密钥' : '无密钥'}</span>
      <button type="button" onClick={() => void onChange({ id: item.id })}>保存配置</button>
    </div>
  ),
}))

vi.mock('../SettingsPageLayout', () => ({
  SettingsPageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

function provider(hasApiKey: boolean): ProviderPublicView {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    baseUrl: 'https://api.example.com',
    apiMode: 'openai',
    integrationId: 'api-key',
    isOfficial: false,
    isEnabled: true,
    createdAt: 0,
    updatedAt: 0,
    hasApiKey,
    capabilities: {
      authentication: 'api-key',
      modelSource: 'models-dev',
      localAuthImport: false,
      usage: 'none',
      endpoint: 'custom',
    },
  }
}

describe('provider manage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(providerApi.listProviders)
      .mockResolvedValueOnce([provider(false)])
      .mockResolvedValue([provider(true)])
    vi.mocked(providerApi.updateProvider).mockResolvedValue(provider(true))
  })

  it('刷新列表后让右侧面板读取最新 Provider，而不是保留旧快照', async () => {
    render(<ProviderManage />)

    fireEvent.click(await screen.findByText('Provider 1'))
    expect(screen.getByTestId('active-provider-key-state')).toHaveTextContent('无密钥')

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => {
      expect(screen.getByTestId('active-provider-key-state')).toHaveTextContent('有密钥')
    })
  })
})
