import { describe, expect, it, vi } from 'vitest'
import { SettingsService } from '../settingsService'

describe('SettingsService', () => {
  it('delegates general settings updates to repository', async () => {
    const repository = {
      getGeneralSettings: vi.fn(),
      updateGeneralSettings: vi.fn(async updates => ({
        assistantModelId: 'model-1',
        proxySettings: updates.proxySettings ?? { mode: 'none' },
      })),
      resetGeneralSettings: vi.fn(),
    }
    const service = new SettingsService(repository)

    const settings = await service.updateGeneralSettings({
      proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' },
    })

    expect(repository.updateGeneralSettings).toHaveBeenCalledWith({
      proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' },
    })
    expect(settings).toEqual({
      assistantModelId: 'model-1',
      proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' },
    })
  })
})
