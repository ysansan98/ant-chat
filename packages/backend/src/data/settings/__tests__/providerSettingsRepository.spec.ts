import type { AppSettingsState } from '@ant-chat/shared'
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
    visionModelId: '',
    visionProviderId: '',
    defaultModelId: '',
    defaultProviderId: '',
    autoGenerateTitle: false,
    developerTools: { agentObservabilityEnabled: false },
    proxySettings: { mode: 'none', customProxyUrl: '' },
    appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
    providers: [
      {
        id: 'provider-1',
        name: 'Provider',
        baseUrl: 'https://example.com',
        apiMode: 'openai',
        integrationId: 'api-key',
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

  it('内部配置只接受当前 Provider 自身的 API Key secret ref audience', () => {
    expect(() => repository.createProvider({
      id: 'provider-2',
      name: 'Provider 2',
      baseUrl: 'https://example.com',
      apiMode: 'openai',
      integrationId: 'api-key',
      apiKeySecretId: 'provider:provider-2:integration:codex-subscription:credential',
      isOfficial: false,
      isEnabled: true,
    } as never)).toThrow('API Key secret ref audience 不匹配')
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

  it('同名模型的启停和删除只影响指定 Provider', () => {
    const scopedRepository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: path.join(dir, 'scoped-model-settings.json'),
      initialSettings: {
        ...initialSettings,
        providers: [
          { ...initialSettings.providers[0], integrationId: 'api-key' },
          {
            ...initialSettings.providers[0],
            id: 'provider-2',
            name: 'Provider 2',
            integrationId: 'api-key',
          },
        ],
      },
    }))

    scopedRepository.setModelEnabledStatus('provider-1', 'test-model', false)

    expect(scopedRepository.getModel('provider-1', 'test-model')?.isEnabled).toBe(false)
    expect(scopedRepository.getModel('provider-2', 'test-model')?.isEnabled).toBe(true)

    scopedRepository.deleteProviderModel('provider-1', 'test-model')

    expect(scopedRepository.getModel('provider-1', 'test-model')).toBeNull()
    expect(scopedRepository.getModel('provider-2', 'test-model')).not.toBeNull()
  })

  it('一次同步保留用户配置、刷新远端元数据，并按首次出现处理重复 ID', () => {
    const models = repository.syncProviderModels('provider-1', [
      {
        id: 'test-model',
        name: '远端新名称',
        maxOutputTokens: 8192,
        contextLength: 32_768,
        capabilities: { reasoning: true },
        cost: { input: 1, output: 2 },
      },
      {
        id: 'test-model',
        name: '重复条目',
        maxOutputTokens: 1,
        contextLength: 1,
      },
      {
        id: 'new-model',
        name: '新模型',
        maxOutputTokens: 4096,
        contextLength: 16_384,
      },
    ])

    expect(models).toEqual([
      expect.objectContaining({
        model: 'test-model',
        name: 'Test Model',
        isEnabled: true,
        temperature: 0.7,
        maxOutputTokens: 8192,
        contextLength: 32_768,
        capabilities: { reasoning: true },
        cost: { input: 1, output: 2 },
      }),
      expect.objectContaining({
        model: 'new-model',
        name: '新模型',
        maxOutputTokens: 4096,
        contextLength: 16_384,
      }),
    ])
  })

  it('同步输入无法持久化时不留下部分模型', () => {
    const before = repository.listProviderModels('provider-1')

    expect(() => repository.syncProviderModels('provider-1', [{
      id: 'broken-model',
      name: '坏模型',
      maxOutputTokens: Number.NaN,
    }])).toThrow()

    expect(repository.listProviderModels('provider-1')).toEqual(before)
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

    // 用户自定义 provider 必须保留，不能被 DEFAULT_APP_SETTINGS 覆盖；
    // 明文 apiKey 不是合法持久化状态，读取时被 schema 丢弃。
    expect(settings.providers).toContainEqual(expect.objectContaining({ id: 'custom-provider' }))
    const legacyProvider = settings.providers.find(provider => provider.id === 'custom-provider')!
    expect(legacyProvider).not.toHaveProperty('apiKey')
    expect(settings.assistantModelId).toBe('gpt-4')
    // 缺失字段以 schema 默认值补齐
    expect(settings.assistantProviderId).toBe('')
  })

  describe('legacy 空 providerId 无歧义回退', () => {
    const baseSettings: AppSettingsState = {
      assistantModelId: '',
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
          id: 'provider-a',
          name: 'A',
          baseUrl: 'https://a.example.com',
          apiMode: 'openai',
          integrationId: 'api-key',
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
          apiMode: 'openai',
          integrationId: 'api-key',
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
})
