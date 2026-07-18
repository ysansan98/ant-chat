import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GeneralSettingsRepository } from '../generalSettingsRepository'

describe('general settings repository', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-settings-'))
    filePath = path.join(dir, 'settings.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('initializes missing settings file with provided settings', async () => {
    const repository = new GeneralSettingsRepository({
      filePath,
      initialSettings: {
        assistantModelId: 'model-1',
        assistantProviderId: '',
        autoGenerateTitle: false,
        proxySettings: { mode: 'none', customProxyUrl: '' },
        appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
        developerTools: { agentObservabilityEnabled: false },
      },
    })

    await expect(repository.getGeneralSettings()).resolves.toEqual({
      assistantModelId: 'model-1',
      assistantProviderId: '',
      autoGenerateTitle: false,
      proxySettings: { mode: 'none', customProxyUrl: '' },
      appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
      developerTools: { agentObservabilityEnabled: false },
    })
  })

  it('updates settings with explicit nested proxy merge', async () => {
    const repository = new GeneralSettingsRepository({
      filePath,
      initialSettings: {
        assistantModelId: 'model-1',
        assistantProviderId: '',
        autoGenerateTitle: false,
        proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' },
        appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
        developerTools: { agentObservabilityEnabled: false },
      },
    })

    const settings = await repository.updateGeneralSettings({
      proxySettings: { mode: 'system' },
    })

    expect(settings).toEqual({
      assistantModelId: 'model-1',
      assistantProviderId: '',
      autoGenerateTitle: false,
      proxySettings: { mode: 'system', customProxyUrl: 'http://localhost:7890' },
      appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
      developerTools: { agentObservabilityEnabled: false },
    })
  })

  it('持久化 Developer Tools 开关且不改写其他设置', async () => {
    const repository = new GeneralSettingsRepository({ filePath })

    const updated = await repository.updateGeneralSettings({
      developerTools: { agentObservabilityEnabled: true },
    })

    expect(updated.developerTools).toEqual({ agentObservabilityEnabled: true })
    await expect(repository.getGeneralSettings()).resolves.toMatchObject({
      developerTools: { agentObservabilityEnabled: true },
      proxySettings: { mode: 'none' },
    })
  })

  it('throws invalid settings file errors with the file path', async () => {
    writeFileSync(filePath, JSON.stringify({ proxySettings: { mode: 'none' } }), 'utf8')
    const repository = new GeneralSettingsRepository({ filePath })

    await expect(repository.getGeneralSettings()).rejects.toThrow(`Invalid settings file: ${filePath}`)
  })
})
