import type { AppSettingsState, SecretRef, SecretStore } from '@ant-chat/shared'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppSettingsStore } from '../appSettingsStore'
import { ProviderSettingsRepository } from '../providerSettingsRepository'

describe('provider settings repository', () => {
  let dir: string
  let repository: ProviderSettingsRepository

  const initialSettings: AppSettingsState = {
    assistantModelId: '',
    assistantProviderId: '',
    proxySettings: { mode: 'none', customProxyUrl: '' },
    toolApprovalWhitelist: [],
    providers: [
      {
        id: 'provider-1',
        name: 'Provider',
        baseUrl: 'https://example.com',
        apiKey: 'key',
        apiMode: 'openai',
        isOfficial: false,
        isEnabled: true,
        models: {
          'test-model': {
            isEnabled: true,
            temperature: 0.7,
            name: 'Test Model',
            maxTokens: 4096,
            contextLength: 8192,
            capabilities: { functionCall: true },
          },
        },
      },
    ],
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-provider-settings-'))
    repository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: path.join(dir, 'settings.json'),
      initialSettings,
    }))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns enabled providers with enabled models', () => {
    expect(repository.getAllAvailableModels()).toEqual([
      expect.objectContaining({
        id: 'provider-1',
        models: [
          expect.objectContaining({
            id: 'test-model',
            model: 'test-model',
            providerId: 'provider-1',
          }),
        ],
      }),
    ])
  })

  it('adds models and rejects duplicates in the same provider', () => {
    const model = repository.createProviderModel({
      providerId: 'provider-1',
      model: 'new-model',
      name: 'New Model',
      maxTokens: 1024,
      contextLength: 2048,
      temperature: 0.5,
    })

    expect(model).toEqual(expect.objectContaining({
      model: 'new-model',
      providerId: 'provider-1',
      isEnabled: true,
    }))
    expect(() => repository.createProviderModel({
      providerId: 'provider-1',
      model: 'new-model',
      name: 'New Model',
      maxTokens: 1024,
      contextLength: 2048,
      temperature: 0.5,
    })).toThrow('new-model 已存在，不可重复添加')
  })

  it('resets invalid existing settings when requested', () => {
    const filePath = path.join(dir, 'invalid-settings.json')
    writeFileSync(filePath, JSON.stringify({ assistantModelId: '', proxySettings: { mode: 'none' } }), 'utf8')

    const store = new AppSettingsStore({ filePath, resetInvalidFile: true })

    const settings = store.read()
    expect(settings.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'openai', models: {} }),
    ]))
  })

  it('迁移明文 provider API Key 后删除配置里的 apiKey', async () => {
    const saved = new Map<string, string>()
    const secretStore: SecretStore = {
      saveProviderApiKey: async ({ providerId, apiKey }) => {
        saved.set(providerId, apiKey)
        return { kind: 'secret_ref', id: `provider:${providerId}:api_key`, scope: 'persistent' }
      },
      getProviderApiKey: async providerId => saved.get(providerId) ?? null,
      deleteProviderApiKey: async (providerId) => {
        saved.delete(providerId)
      },
      createTurnSecret: async (): Promise<SecretRef> => ({ kind: 'secret_ref', id: 'turn:run-1:secret-1', scope: 'turn' }),
      resolve: async () => null,
      clearTurnSecrets: async () => {},
    }

    await expect(repository.migratePlaintextApiKeys(secretStore)).resolves.toBe(true)

    const provider = repository.getProviderSettingsById('provider-1')
    expect(provider).toEqual(expect.objectContaining({
      id: 'provider-1',
      apiKeySecretId: 'provider:provider-1:api_key',
    }))
    expect(provider).not.toHaveProperty('apiKey')
    expect(saved.get('provider-1')).toBe('key')
  })
})
