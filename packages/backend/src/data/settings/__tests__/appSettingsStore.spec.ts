import type { AppSettingsState } from '@ant-chat/shared'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('默认内置服务商列表包含 Codex 订阅', () => {
    const store = new AppSettingsStore({ filePath: path.join(dir, 'settings.json') })

    expect(store.read().providers).toContainEqual(expect.objectContaining({
      id: 'codex',
      name: 'OpenAI Codex',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiMode: 'openai',
      integrationId: 'codex-subscription',
      isOfficial: true,
    }))
  })

  it('把旧版 Codex apiMode 迁移为独立订阅 Integration，并保留 openai wire protocol', () => {
    const filePath = path.join(dir, 'legacy-codex-settings.json')
    const codex = DEFAULT_APP_SETTINGS.providers.find(provider => provider.id === 'codex')!
    const legacyCodex = { ...codex, apiMode: 'codex', integrationId: undefined }
    writeFileSync(filePath, JSON.stringify({
      schemaVersion: 4,
      data: { ...DEFAULT_APP_SETTINGS, providers: [legacyCodex] },
    }), 'utf8')

    const store = new AppSettingsStore({ filePath })

    expect(store.read().providers[0]).toEqual(expect.objectContaining({
      apiMode: 'openai',
      integrationId: 'codex-subscription',
    }))
  })

  it('旧 settings 中运行时派生的 capabilities 字段被剥离且不再写回', () => {
    const filePath = path.join(dir, 'stale-capabilities.json')
    const codex = DEFAULT_APP_SETTINGS.providers.find(provider => provider.id === 'codex')!
    writeFileSync(filePath, JSON.stringify({
      schemaVersion: 5,
      data: {
        ...DEFAULT_APP_SETTINGS,
        providers: [{
          ...codex,
          capabilities: {
            authentication: 'oauth',
            modelSource: 'provider',
            localAuthImport: true,
            usage: 'quota',
            endpoint: 'fixed',
            fixedBaseUrl: 'https://chatgpt.com/backend-api/codex',
          },
        }],
      },
    }), 'utf8')

    const store = new AppSettingsStore({ filePath })

    expect(store.read().providers[0]).not.toHaveProperty('capabilities')
    const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as { data: { providers: Array<Record<string, unknown>> } }
    expect(persisted.data.providers[0]).not.toHaveProperty('capabilities')
  })

  it('自动重置开启时也拒绝覆盖更高版本的设置文件', () => {
    const filePath = path.join(dir, 'future-settings.json')
    const original = JSON.stringify({ schemaVersion: 6, data: DEFAULT_APP_SETTINGS })
    writeFileSync(filePath, original, 'utf8')

    expect(() => new AppSettingsStore({ filePath, resetInvalidFile: true }))
      .toThrow('文件 schema 版本 6 高于当前支持的 5')
    expect(readFileSync(filePath, 'utf8')).toBe(original)
  })

  it('将版本 1 provider model 的 maxTokens 一次性迁移为 maxOutputTokens', () => {
    const filePath = path.join(dir, 'legacy-settings.json')
    const provider = DEFAULT_APP_SETTINGS.providers[0]
    const legacySettings = {
      ...DEFAULT_APP_SETTINGS,
      providers: [
        {
          ...provider,
          models: {
            'legacy-model': {
              isEnabled: true,
              maxTokens: 8192,
              contextLength: 32768,
              cost: { input: 0, output: 0 },
            },
            'already-migrated-model': {
              isEnabled: true,
              maxTokens: 1024,
              maxOutputTokens: 16384,
              contextLength: 32768,
              cost: { input: 0, output: 0 },
            },
          },
        },
      ],
    }
    writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, data: legacySettings }), 'utf8')

    const store = new AppSettingsStore({ filePath })
    const models = store.read().providers[0].models

    expect(models['legacy-model'].maxOutputTokens).toBe(8192)
    expect(models['already-migrated-model'].maxOutputTokens).toBe(16384)

    const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as {
      schemaVersion: number
      data: { providers: Array<{ models: Record<string, Record<string, unknown>> }> }
    }
    expect(persisted.schemaVersion).toBe(5)
    expect(persisted.data.providers[0].models['legacy-model']).not.toHaveProperty('maxTokens')
    expect(persisted.data.providers[0].models['already-migrated-model']).not.toHaveProperty('maxTokens')
  })

  it('版本 3 设置可直接升级且只删除旧白名单，不生成权限数据', () => {
    const filePath = path.join(dir, 'version-3-settings.json')
    writeFileSync(filePath, JSON.stringify({
      schemaVersion: 3,
      data: {
        ...DEFAULT_APP_SETTINGS,
        toolApprovalWhitelist: [
          {
            toolName: 'execute_command',
            operationType: 'command',
            toolScope: 'workspace',
            pattern: 'git **',
            description: '旧规则',
          },
        ],
      },
    }), 'utf8')

    expect(() => new AppSettingsStore({ filePath })).not.toThrow()
    const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as {
      schemaVersion: number
      data: Record<string, unknown>
    }
    expect(persisted.schemaVersion).toBe(5)
    expect(persisted.data).not.toHaveProperty('toolApprovalWhitelist')
    expect(readFileSync(filePath, 'utf8')).not.toContain('permissions')
  })

  describe('mergeBuiltinProviders', () => {
    it('should add new builtin providers to existing settings', () => {
      const filePath = path.join(dir, 'settings.json')
      const existingSettings: AppSettingsState = {
        assistantModelId: 'test-model',
        assistantProviderId: '',
        visionModelId: '',
        visionProviderId: '',
        defaultModelId: '',
        defaultProviderId: '',
        autoGenerateTitle: false,
        developerTools: { agentObservabilityEnabled: false },
        proxySettings: { mode: 'none' },
        appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
        providers: [
          {
            id: 'existing-provider',
            name: 'Existing Provider',
            baseUrl: 'https://example.com',
            apiMode: 'openai',
            integrationId: 'api-key',
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
        visionModelId: '',
        visionProviderId: '',
        defaultModelId: '',
        defaultProviderId: '',
        autoGenerateTitle: false,
        developerTools: { agentObservabilityEnabled: false },
        proxySettings: { mode: 'none' },
        appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
        providers: [
          {
            id: 'openai',
            name: 'Custom OpenAI Name', // User customized name
            baseUrl: 'https://custom-url.com',
            apiMode: 'openai',
            integrationId: 'api-key',
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
      // 明文 apiKey 不再作为合法持久化状态保留
      expect(openai).not.toHaveProperty('apiKey')
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
        visionModelId: '',
        visionProviderId: '',
        defaultModelId: '',
        defaultProviderId: '',
        autoGenerateTitle: false,
        developerTools: { agentObservabilityEnabled: false },
        proxySettings: { mode: 'none' },
        appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
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
