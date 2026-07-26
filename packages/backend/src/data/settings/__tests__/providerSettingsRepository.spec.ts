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
    autoGenerateTitle: false,
    developerTools: { agentObservabilityEnabled: false },
    proxySettings: { mode: 'none', customProxyUrl: '' },
    appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
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
            maxOutputTokens: 4096,
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
      maxOutputTokens: 1024,
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
      maxOutputTokens: 1024,
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

  it('旧 settings.json 仅缺 assistantProviderId 时不被重置为默认值', () => {
    const filePath = path.join(dir, 'legacy-settings.json')
    // 升级前的文件：字段齐全，仅缺少本 PR 新增的 assistantProviderId
    const legacy = {
      assistantModelId: 'gpt-4',
      proxySettings: { mode: 'none' },
      providers: [
        {
          id: 'custom-provider',
          name: 'Custom',
          baseUrl: 'https://example.com',
          apiKey: 'key',
          apiMode: 'openai',
          isOfficial: false,
          isEnabled: true,
          models: {
            'gpt-4': { isEnabled: true, temperature: 0.7, name: 'GPT-4', maxOutputTokens: 8192, contextLength: 32768, cost: { input: 0, output: 0 } },
          },
        },
      ],
    }
    writeFileSync(filePath, JSON.stringify(legacy), 'utf8')

    const store = new AppSettingsStore({ filePath, resetInvalidFile: true })
    const settings = store.read()

    // 用户自定义 provider 必须保留，不能被 DEFAULT_APP_SETTINGS 覆盖
    expect(settings.providers).toContainEqual(
      expect.objectContaining({ id: 'custom-provider', apiKey: 'key' }),
    )
    expect(settings.assistantModelId).toBe('gpt-4')
    // 缺失字段以 schema 默认值补齐
    expect(settings.assistantProviderId).toBe('')
  })

  describe('legacy 空 providerId 无歧义回退', () => {
    const baseSettings: AppSettingsState = {
      assistantModelId: '',
      assistantProviderId: '',
      autoGenerateTitle: false,
      developerTools: { agentObservabilityEnabled: false },
      proxySettings: { mode: 'none' },
      appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
      providers: [
        {
          id: 'provider-a',
          name: 'A',
          baseUrl: 'https://a.example.com',
          apiKey: 'key-a',
          apiMode: 'openai',
          isOfficial: false,
          isEnabled: true,
          models: {
            'shared-model': { isEnabled: true, temperature: 0.7, name: 'Shared', maxOutputTokens: 4096, contextLength: 8192, cost: { input: 0, output: 0 } },
            'a-only-model': { isEnabled: true, temperature: 0.7, name: 'A Only', maxOutputTokens: 4096, contextLength: 8192, cost: { input: 0, output: 0 } },
          },
        },
        {
          id: 'provider-b',
          name: 'B',
          baseUrl: 'https://b.example.com',
          apiKey: 'key-b',
          apiMode: 'openai',
          isOfficial: false,
          isEnabled: true,
          models: {
            'shared-model': { isEnabled: true, temperature: 0.7, name: 'Shared', maxOutputTokens: 4096, contextLength: 8192, cost: { input: 0, output: 0 } },
          },
        },
      ],
    }

    const tempDirs: string[] = []

    afterEach(() => {
      for (const d of tempDirs.splice(0)) {
        rmSync(d, { recursive: true, force: true })
      }
    })

    function makeRepository(): ProviderSettingsRepository {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'ant-chat-legacy-provider-'))
      tempDirs.push(tmpDir)
      return new ProviderSettingsRepository(new AppSettingsStore({
        filePath: path.join(tmpDir, 'settings.json'),
        initialSettings: baseSettings,
      }))
    }

    it('providerId 为空且 modelId 仅 1 个已启用 provider 拥有时命中回退', () => {
      const repo = makeRepository()
      const resolved = repo.resolveModel('', 'a-only-model')
      expect(resolved).not.toBeNull()
      expect(resolved?.provider.id).toBe('provider-a')
      expect(resolved?.model.id).toBe('a-only-model')

      const model = repo.getModel('', 'a-only-model')
      expect(model).not.toBeNull()
      expect(model?.providerId).toBe('provider-a')
    })

    it('providerId 为空且 modelId 在多个 provider 间有歧义时返回 null', () => {
      const repo = makeRepository()
      expect(repo.resolveModel('', 'shared-model')).toBeNull()
      expect(repo.getModel('', 'shared-model')).toBeNull()
    })

    it('providerId 为空且 modelId 不存在时返回 null', () => {
      const repo = makeRepository()
      expect(repo.resolveModel('', 'no-such-model')).toBeNull()
      expect(repo.getModel('', 'no-such-model')).toBeNull()
    })

    it('显式 providerId 仍走精确查找，不触发跨 provider 回退', () => {
      const repo = makeRepository()
      // provider-b 没有 a-only-model，即便 provider-a 有，也不应回退
      expect(repo.resolveModel('provider-b', 'a-only-model')).toBeNull()
      expect(repo.getModel('provider-b', 'a-only-model')).toBeNull()
    })
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
