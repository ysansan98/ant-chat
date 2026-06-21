import type { AppSettingsState } from '@ant-chat/shared'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppSettingsStore } from '../appSettingsStore'
import { DEFAULT_APP_SETTINGS } from '../defaultAppSettings'

describe('appSettingsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-app-settings-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('mergeBuiltinProviders', () => {
    it('should add new builtin providers to existing settings', () => {
      const filePath = path.join(dir, 'settings.json')
      const existingSettings: AppSettingsState = {
        assistantModelId: 'test-model',
        assistantProviderId: '',
        proxySettings: { mode: 'none' },
        toolApprovalWhitelist: [],
        providers: [
          {
            id: 'existing-provider',
            name: 'Existing Provider',
            baseUrl: 'https://example.com',
            apiKey: 'key',
            apiMode: 'openai',
            isOfficial: false,
            isEnabled: true,
            models: {},
          },
        ],
      }
      writeFileSync(filePath, JSON.stringify(existingSettings), 'utf8')

      const store = new AppSettingsStore({ filePath })
      const settings = store.read()

      // Should keep existing provider
      expect(settings.providers).toContainEqual(
        expect.objectContaining({ id: 'existing-provider' }),
      )

      // Should add new providers from DEFAULT_APP_SETTINGS
      const existingIds = existingSettings.providers.map(p => p.id)
      const newDefaultProviders = DEFAULT_APP_SETTINGS.providers.filter(
        p => !existingIds.includes(p.id),
      )
      for (const provider of newDefaultProviders) {
        expect(settings.providers).toContainEqual(
          expect.objectContaining({ id: provider.id }),
        )
      }
    })

    it('should not modify providers that already exist', () => {
      const filePath = path.join(dir, 'settings.json')
      const existingSettings: AppSettingsState = {
        assistantModelId: 'test-model',
        assistantProviderId: '',
        proxySettings: { mode: 'none' },
        toolApprovalWhitelist: [],
        providers: [
          {
            id: 'openai',
            name: 'Custom OpenAI Name', // User customized name
            baseUrl: 'https://custom-url.com',
            apiKey: 'custom-key',
            apiMode: 'openai',
            isOfficial: true,
            isEnabled: true, // User enabled it
            models: {
              'gpt-4': {
                isEnabled: true,
                temperature: 0.5,
              },
            },
          },
        ],
      }
      writeFileSync(filePath, JSON.stringify(existingSettings), 'utf8')

      const store = new AppSettingsStore({ filePath })
      const settings = store.read()

      const openai = settings.providers.find(p => p.id === 'openai')!

      // Should preserve user's customizations
      expect(openai.name).toBe('Custom OpenAI Name')
      expect(openai.baseUrl).toBe('https://custom-url.com')
      expect(openai.apiKey).toBe('custom-key')
      expect(openai.isEnabled).toBe(true)
      expect(openai.models['gpt-4'].isEnabled).toBe(true)
      expect(openai.models['gpt-4'].temperature).toBe(0.5)
    })

    it('should not write when no new providers exist', () => {
      const filePath = path.join(dir, 'settings.json')
      // Create settings with all default providers
      const existingSettings: AppSettingsState = {
        ...DEFAULT_APP_SETTINGS,
        providers: [...DEFAULT_APP_SETTINGS.providers],
      }
      writeFileSync(filePath, JSON.stringify(existingSettings), 'utf8')

      const store = new AppSettingsStore({ filePath })
      const settings = store.read()

      // Should have same number of providers
      expect(settings.providers.length).toBe(DEFAULT_APP_SETTINGS.providers.length)
    })

    it('should handle empty providers array', () => {
      const filePath = path.join(dir, 'settings.json')
      const existingSettings: AppSettingsState = {
        assistantModelId: 'test-model',
        assistantProviderId: '',
        proxySettings: { mode: 'none' },
        toolApprovalWhitelist: [],
        providers: [],
      }
      writeFileSync(filePath, JSON.stringify(existingSettings), 'utf8')

      const store = new AppSettingsStore({ filePath })
      const settings = store.read()

      // Should add all default providers
      expect(settings.providers.length).toBe(DEFAULT_APP_SETTINGS.providers.length)
    })
  })
})
