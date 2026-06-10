import { describe, expect, it, vi } from 'vitest'
import { SettingsIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  settings: {
    get: vi.fn(async () => ({
      assistantModelId: 'model-1',
      proxySettings: { mode: 'none' },
    })),
    update: vi.fn(async updates => ({
      assistantModelId: 'model-2',
      proxySettings: updates.proxySettings ?? { mode: 'none' },
    })),
    reset: vi.fn(async () => ({
      assistantModelId: '',
      proxySettings: { mode: 'none' },
    })),
  },
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/runtime/appRuntime', () => ({
  getAppRuntime: () => ({
    settings: mocks.settings,
  }),
}))

vi.mock('@main/windows/settings-window', () => ({
  openSettingsWindow: vi.fn(async () => {}),
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
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
    expect(mocks.settings.update).toHaveBeenCalledWith({
      proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' },
    })
  })
})
