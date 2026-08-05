import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browserProfilesApi } from '@/api/browserProfilesApi'
import { generalSettingsApi } from '@/api/generalSettingsApi'
import { observabilityApi } from '@/api/observabilityApi'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { GeneralSettings } from './GeneralSettings'

vi.mock('@/api/observabilityApi', () => ({
  observabilityApi: { clearAll: vi.fn() },
}))

vi.mock('@/api/generalSettingsApi', () => ({
  generalSettingsApi: {
    updateSettings: vi.fn(),
    getSettings: vi.fn(),
    resetSettings: vi.fn(),
  },
}))

vi.mock('@/api/browserProfilesApi', () => ({
  browserProfilesApi: {
    getStatus: vi.fn(),
    listSources: vi.fn(),
    importSource: vi.fn(),
    importFromDirectory: vi.fn(),
    clear: vi.fn(),
  },
}))

vi.mock('@/api/transports/appRpc', () => ({
  getAppRuntimeCapabilities: () => ({ nativeWindow: false, autoUpdate: false, nativeFilePicker: false }),
}))

describe('generalSettings Agent Observability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGeneralSettingsStore.setState(settings(false))
    vi.mocked(generalSettingsApi.updateSettings).mockResolvedValue(settings(true))
    vi.mocked(observabilityApi.clearAll).mockResolvedValue(null)
    vi.mocked(browserProfilesApi.getStatus).mockResolvedValue({ imported: false })
    vi.mocked(browserProfilesApi.listSources).mockResolvedValue([])
  })

  it('开启后从下一个 Turn 开始采集', async () => {
    render(<GeneralSettings />)

    fireEvent.click(screen.getByRole('switch', { name: '启用 Agent Observability' }))

    await waitFor(() => expect(generalSettingsApi.updateSettings).toHaveBeenCalledWith({
      developerTools: { agentObservabilityEnabled: true },
    }))
    expect(screen.getByRole('switch', { name: '启用 Agent Observability' })).toBeChecked()
  })

  it('确认后清除全部 Trace', async () => {
    render(<GeneralSettings />)

    fireEvent.click(screen.getByRole('button', { name: '清除全部' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认清除' }))

    await waitFor(() => expect(observabilityApi.clearAll).toHaveBeenCalledOnce())
  })
})

function settings(agentObservabilityEnabled: boolean) {
  return {
    assistantModelId: '',
    assistantProviderId: '',
    defaultModelId: '',
    defaultProviderId: '',
    autoGenerateTitle: false,
    reasoningEffort: undefined,
    proxySettings: { mode: 'none' as const, customProxyUrl: '' },
    appearance: { mode: 'system' as const, lightThemeId: 'default', darkThemeId: 'default' },
    developerTools: { agentObservabilityEnabled },
    isLoading: false,
  }
}
