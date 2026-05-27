import { describe, expect, it, vi } from 'vitest'
import { SettingsIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  settingsService: {
    getGeneralSettings: vi.fn(async () => ({
      assistantModelId: 'model-1',
      proxySettings: { mode: 'none' },
    })),
    updateGeneralSettings: vi.fn(async updates => ({
      assistantModelId: 'model-2',
      proxySettings: updates.proxySettings ?? { mode: 'none' },
    })),
    resetGeneralSettings: vi.fn(async () => ({
      assistantModelId: '',
      proxySettings: { mode: 'none' },
    })),
  },
  updateProxySettings: vi.fn(async () => {}),
  mainSend: vi.fn(),
  settingsSend: vi.fn(),
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/adapters/appDataContainer', () => ({
  getAppDataServices: () => ({
    settingsService: mocks.settingsService,
  }),
}))

vi.mock('@main/windows/settings-window', () => ({
  getSettingsWindow: () => ({ isDestroyed: () => false, webContents: { send: mocks.settingsSend } }),
  openSettingsWindow: vi.fn(async () => {}),
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

vi.mock('@main/utils/proxy-manager', () => ({
  ProxyManager: {
    getInstance: () => ({
      updateProxySettings: mocks.updateProxySettings,
    }),
  },
}))

vi.mock('@main/utils/system-proxy', () => ({
  testProxyConnection: vi.fn(async () => true),
}))

vi.mock('@main/windows/window', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: mocks.mainSend } }),
}))

describe('settings ipc', () => {
  it('reads settings from app-data service', async () => {
    const service = new SettingsIpcService()
    const resp = await service.getSettings()

    expect(resp.success).toBe(true)
    if (resp.success) {
      expect(resp.data.assistantModelId).toBe('model-1')
    }
  })

  it('updates settings through app-data service and broadcasts changed keys', async () => {
    const service = new SettingsIpcService()
    const resp = await service.updateSettings({ proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' } })

    expect(resp.success).toBe(true)
    expect(mocks.settingsService.updateGeneralSettings).toHaveBeenCalledWith({
      proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' },
    })
    expect(mocks.updateProxySettings).toHaveBeenCalledWith({ mode: 'custom', customProxyUrl: 'http://localhost:7890' })
    expect(mocks.mainSend).toHaveBeenCalledWith('settings:updated', { keys: ['proxySettings'] })
    expect(mocks.settingsSend).toHaveBeenCalledWith('settings:updated', { keys: ['proxySettings'] })
  })
})
