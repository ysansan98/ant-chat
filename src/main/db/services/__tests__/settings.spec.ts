import { beforeEach, describe, expect, it } from 'vitest'
import { getGeneralSettings, resetGeneralSettings, updateGeneralSettings } from '../settings'
import { canRunDbIntegrationTests, mockDb } from './utils'

const describeDb = canRunDbIntegrationTests() ? describe : describe.skip

describeDb('settings service', () => {
  beforeEach(async () => {
    await mockDb()
  })

  it('returns default general settings when no row exists', async () => {
    const settings = await getGeneralSettings()

    expect(settings).toEqual({
      assistantModelId: '',
      proxySettings: {
        mode: 'none',
        customProxyUrl: '',
      },
    })
  })

  it('updates general settings and preserves nested proxy fields', async () => {
    await updateGeneralSettings({
      assistantModelId: 'model-1',
      proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' },
    })

    const settings = await updateGeneralSettings({
      proxySettings: { mode: 'system' },
    })

    expect(settings).toEqual({
      assistantModelId: 'model-1',
      proxySettings: {
        mode: 'system',
        customProxyUrl: 'http://localhost:7890',
      },
    })
  })

  it('resets general settings', async () => {
    await updateGeneralSettings({ assistantModelId: 'model-1' })

    const settings = await resetGeneralSettings()

    expect(settings).toEqual({
      assistantModelId: '',
      proxySettings: {
        mode: 'none',
        customProxyUrl: '',
      },
    })
  })
})
