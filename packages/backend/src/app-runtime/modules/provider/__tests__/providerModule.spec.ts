import type { AppSettingsState, CreateProviderConfigSchema } from '@ant-chat/shared'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderSettingsRepository } from '../../../../data/settings/providerSettingsRepository'
import { AppSettingsStore } from '../../../../data/settings/appSettingsStore'
import type { RuntimeEventBus } from '../../../../events'
import { DEFAULT_APP_SETTINGS } from '../../../../data/settings/defaultAppSettings'
import type { KeychainSecretStore } from '../../../../secretStore'
import type { SystemLogger } from '../../../../systemLogger'
import { ProviderModule, resolveProviderApiKey } from '../index'
import { createCodexProviderIntegration } from '../codexIntegration'
import type { ProviderIntegration } from '../providerIntegration'

describe('provider module 模型同步行为', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ant-chat-provider-module-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('统一 syncModels RPC 使用当前 Codex 客户端版本获取 5.6 模型', async () => {
    const codex = DEFAULT_APP_SETTINGS.providers.find(provider => provider.id === 'codex')!
    const settings: AppSettingsState = {
      ...DEFAULT_APP_SETTINGS,
      providers: [{
        ...codex,
        baseUrl: 'https://attacker.example/collect',
        models: {
          'gpt-5.6-sol': {
            isEnabled: true,
            name: '旧模型名称',
            capabilities: { reasoning: false },
          },
        },
      }],
    }
    const repository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: join(directory, 'settings.json'),
      initialSettings: settings,
    }))
    const secretStore = {
      getProviderIntegrationCredential: vi.fn(async () => JSON.stringify({ accessToken: 'access-token' })),
      saveProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
    } as unknown as KeychainSecretStore
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input))
      const models = url.searchParams.get('client_version') === '0.146.0'
        ? [
            {
              slug: 'gpt-5.6-sol',
              display_name: 'GPT-5.6-Sol',
              context_window: 256_000,
              supports_reasoning_summaries: true,
              supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }],
            },
            { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', context_window: 256_000 },
            { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', context_window: 256_000 },
          ]
        : [{ slug: 'gpt-5.4', display_name: 'GPT-5.4', context_window: 256_000 }]
      return new Response(JSON.stringify({ models }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const emit = vi.fn()
    const module = new ProviderModule(
      repository,
      secretStore,
      { emit } as unknown as RuntimeEventBus,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SystemLogger,
      undefined,
      [['codex-subscription', createCodexProviderIntegration(secretStore)]],
    )

    const models = await module.syncModels({ providerId: 'codex' })

    expect(models).toEqual([
      expect.objectContaining({
        model: 'gpt-5.6-sol',
        name: '旧模型名称',
        capabilities: expect.objectContaining({ reasoningLevels: ['low', 'medium', 'high', 'xhigh'] }),
      }),
      expect.objectContaining({ model: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', contextLength: 256_000 }),
      expect.objectContaining({ model: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', contextLength: 256_000 }),
    ])
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://chatgpt.com/backend-api/codex/models?client_version=0.146.0')
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer access-token')
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('ChatGPT-Account-ID')).toBeNull()
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes('attacker.example'))).toBe(true)
    expect(emit).toHaveBeenCalledTimes(1)
    const publicProvider = module.getProviderById({ id: 'codex' })
    expect(publicProvider).not.toHaveProperty('apiKey')
    expect(publicProvider).not.toHaveProperty('apiKeySecretId')
    expect(publicProvider.capabilities).toEqual(expect.objectContaining({
      authentication: 'oauth',
      usage: 'quota',
      endpoint: 'fixed',
    }))
    module.dispose()
  })

  it('通过 RPC 创建自定义 Codex Provider 后 integrationId 持久化并可进入 Codex 认证路径', async () => {
    const repository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: join(directory, 'settings.json'),
      initialSettings: DEFAULT_APP_SETTINGS,
    }))
    const secretStore = {
      getProviderIntegrationCredential: vi.fn(async () => null),
      saveProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
    } as unknown as KeychainSecretStore
    const emit = vi.fn()
    const module = new ProviderModule(
      repository,
      secretStore,
      { emit } as unknown as RuntimeEventBus,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SystemLogger,
      undefined,
      [['codex-subscription', createCodexProviderIntegration(secretStore)]],
    )

    const created = await module.createProvider({
      config: {
        id: 'custom-codex',
        name: '我的 Codex',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        integrationId: 'codex-subscription',
        apiMode: 'openai',
        isEnabled: true,
      },
    })

    expect(created.integrationId).toBe('codex-subscription')
    expect(module.listIntegrations()).toEqual([
      expect.objectContaining({ id: 'api-key', label: 'API Key', authentication: 'api-key' }),
      expect.objectContaining({
        id: 'codex-subscription',
        label: 'Codex 订阅',
        authentication: 'oauth',
        fixedApiMode: 'openai',
        fixedBaseUrl: 'https://chatgpt.com/backend-api/codex',
      }),
    ])
    expect(created.capabilities).toEqual(expect.objectContaining({
      authentication: 'oauth',
      usage: 'quota',
      endpoint: 'fixed',
    }))

    // 重新从持久化状态读取，integrationId 不应因 repository 构造遗漏而丢失。
    const reloaded = module.getProviderById({ id: 'custom-codex' })
    expect(reloaded.integrationId).toBe('codex-subscription')
    expect(reloaded.capabilities?.authentication).toBe('oauth')

    // 应存在 Codex auth adapter（OAuth 路径可用），而不是回退到 API Key。
    await expect(module.getAuthStatus({ providerId: 'custom-codex' })).resolves.toEqual(
      expect.objectContaining({ authenticated: false, state: 'missing' }),
    )
    module.dispose()
  })

  it('createProvider 的 capabilities 由 Integration 派生，调用方无法伪造', async () => {
    const repository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: join(directory, 'settings.json'),
      initialSettings: DEFAULT_APP_SETTINGS,
    }))
    const secretStore = {
      getProviderIntegrationCredential: vi.fn(async () => null),
      saveProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
    } as unknown as KeychainSecretStore
    const module = new ProviderModule(
      repository,
      secretStore,
      { emit: vi.fn() } as unknown as RuntimeEventBus,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SystemLogger,
      undefined,
      [['codex-subscription', createCodexProviderIntegration(secretStore)]],
    )

    const created = await module.createProvider({
      config: {
        id: 'custom-codex',
        name: '我的 Codex',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        integrationId: 'codex-subscription',
        apiMode: 'openai',
        isEnabled: true,
        // 调用方尝试把 capabilities 伪造成 API Key 形态，必须被剥离并由 Integration 派生覆盖。
        capabilities: {
          authentication: 'api-key',
          modelSource: 'models-dev',
          localAuthImport: false,
          usage: 'none',
          endpoint: 'custom',
        },
      } as unknown as CreateProviderConfigSchema,
    })

    expect(created.capabilities).toEqual(expect.objectContaining({
      authentication: 'oauth',
      usage: 'quota',
      endpoint: 'fixed',
    }))
    // capabilities 不进入持久化 settings，运行时再由 Integration 派生。
    expect(repository.getProviderSettingsById('custom-codex')).not.toHaveProperty('capabilities')
    module.dispose()
  })
})

describe('provider module 认证生命周期撤销', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ant-chat-provider-lifecycle-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function createModule(secretStore: Partial<KeychainSecretStore>) {
    const repository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: join(directory, 'settings.json'),
      initialSettings: DEFAULT_APP_SETTINGS,
    }))
    const emit = vi.fn()
    const completeSecretStore = {
      getProviderApiKey: vi.fn(async () => null),
      saveProviderApiKey: vi.fn(async ({ providerId }: { providerId: string }) => ({
        kind: 'secret_ref' as const,
        id: `provider:${providerId}:api_key`,
        scope: 'persistent' as const,
      })),
      deleteProviderApiKey: vi.fn(async () => {}),
      getProviderIntegrationCredential: vi.fn(async () => null),
      saveProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
      ...secretStore,
    } as unknown as KeychainSecretStore
    const module = new ProviderModule(
      repository,
      completeSecretStore,
      { emit } as unknown as RuntimeEventBus,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SystemLogger,
      undefined,
      [['codex-subscription', createCodexProviderIntegration(completeSecretStore)]],
    )
    return { module, repository }
  }

  it('api key Provider 拒绝解析其他 credential audience 的 secret ref', async () => {
    const resolve = vi.fn(async () => 'codex-token')
    const secretStore = {
      resolve,
      getProviderApiKey: vi.fn(async () => null),
    } as unknown as KeychainSecretStore

    await expect(resolveProviderApiKey(secretStore, {
      id: 'provider-1',
      apiKeySecretId: 'provider:provider-1:integration:codex-subscription:credential',
    })).rejects.toThrow('API Key secret ref audience 不匹配')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('createProvider 在重复配置校验失败前不写入 API Key', async () => {
    const saveProviderApiKey = vi.fn(async () => ({
      kind: 'secret_ref' as const,
      id: 'provider:openai:api_key',
      scope: 'persistent' as const,
    }))
    const { module } = createModule({
      saveProviderApiKey,
      deleteProviderApiKey: vi.fn(async () => {}),
    })

    await expect(module.createProvider({
      config: {
        id: 'openai',
        name: '重复 OpenAI',
        baseUrl: 'https://api.openai.com',
        apiMode: 'openai',
        integrationId: 'api-key',
        apiKey: 'replacement-secret',
      },
    })).rejects.toThrow('Provider already exists')

    expect(saveProviderApiKey).not.toHaveBeenCalled()
  })

  it('createProvider 的 settings 写入失败时恢复同 audience 的既有孤儿密钥', async () => {
    let apiKey: string | null = 'orphan-key'
    const { module, repository } = createModule({
      getProviderApiKey: vi.fn(async () => apiKey),
      saveProviderApiKey: vi.fn(async ({ providerId, apiKey: value }: { providerId: string, apiKey: string }) => {
        apiKey = value
        return { kind: 'secret_ref' as const, id: `provider:${providerId}:api_key`, scope: 'persistent' as const }
      }),
      deleteProviderApiKey: vi.fn(async () => { apiKey = null }),
    })
    vi.spyOn(repository, 'createProvider').mockImplementation(() => {
      throw new Error('settings unavailable')
    })

    await expect(module.createProvider({
      config: {
        id: 'new-provider',
        name: 'New Provider',
        baseUrl: 'https://api.example.com',
        apiMode: 'openai',
        integrationId: 'api-key',
        apiKey: 'new-key',
      },
    })).rejects.toThrow('settings unavailable')

    expect(apiKey).toBe('orphan-key')
  })

  it('updateProvider 把 integrationId 从 Codex 切到 API Key 时撤销旧 OAuth 凭据', async () => {
    const deleteProviderIntegrationCredential = vi.fn(async () => {})
    const { module } = createModule({
      getProviderIntegrationCredential: vi.fn(async () => JSON.stringify({ accessToken: 'old-token' })),
      deleteProviderIntegrationCredential,
      deleteProviderApiKey: vi.fn(async () => {}),
    })

    await module.updateProvider({
      config: { id: 'codex', integrationId: 'api-key' },
    })

    expect(deleteProviderIntegrationCredential).toHaveBeenCalledWith({ providerId: 'codex', integrationId: 'codex-subscription' })
  })

  it('updateProvider 从 API Key 切到订阅 Integration 时清除旧 API Key 引用', async () => {
    const deleteProviderApiKey = vi.fn(async () => {})
    const { module, repository } = createModule({
      getProviderIntegrationCredential: vi.fn(async () => null),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderApiKey,
    })

    await module.updateProvider({
      config: {
        id: 'openai',
        integrationId: 'codex-subscription',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        apiMode: 'openai',
      },
    })

    expect(deleteProviderApiKey).toHaveBeenCalledWith('openai')
    expect(repository.getProviderSettingsById('openai')).not.toHaveProperty('apiKeySecretId')
    expect(module.getProviderById({ id: 'openai' }).hasApiKey).toBe(false)
  })

  it('updateProvider 按合并后的完整配置校验目标 Integration', async () => {
    const { module, repository } = createModule({
      getProviderIntegrationCredential: vi.fn(async () => null),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderApiKey: vi.fn(async () => {}),
    })

    await expect(module.updateProvider({
      config: { id: 'codex', baseUrl: 'https://attacker.example' },
    })).rejects.toThrow('固定 endpoint')

    expect(repository.getProviderById('codex')?.baseUrl).toBe('https://chatgpt.com/backend-api/codex')
  })

  it('切换 Integration 撤销旧凭据失败时保持旧配置可重试', async () => {
    const { module, repository } = createModule({
      getProviderIntegrationCredential: vi.fn(async () => JSON.stringify({ accessToken: 'token' })),
      deleteProviderIntegrationCredential: vi.fn(async () => {
        throw new Error('keychain unavailable')
      }),
      deleteProviderApiKey: vi.fn(async () => {}),
    })

    await expect(module.updateProvider({
      config: {
        id: 'codex',
        integrationId: 'api-key',
        baseUrl: 'https://api.example.com',
        apiMode: 'openai',
      },
    })).rejects.toThrow('keychain unavailable')

    expect(repository.getProviderById('codex')).toMatchObject({
      integrationId: 'codex-subscription',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    })
  })

  it('更新 API Key 后 settings 写入失败时恢复旧密钥', async () => {
    let apiKey: string | null = 'old-key'
    const saveProviderApiKey = vi.fn(async ({ providerId, apiKey: value }: { providerId: string, apiKey: string }) => {
      apiKey = value
      return { kind: 'secret_ref' as const, id: `provider:${providerId}:api_key`, scope: 'persistent' as const }
    })
    const { module, repository } = createModule({
      getProviderApiKey: vi.fn(async () => apiKey),
      saveProviderApiKey,
      deleteProviderApiKey: vi.fn(async () => { apiKey = null }),
      getProviderIntegrationCredential: vi.fn(async () => null),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
    })
    vi.spyOn(repository, 'updateProvider').mockImplementation(() => {
      throw new Error('settings unavailable')
    })

    await expect(module.updateProvider({
      config: { id: 'openai', apiKey: 'new-key' },
    })).rejects.toThrow('settings unavailable')

    expect(apiKey).toBe('old-key')
    expect(saveProviderApiKey).toHaveBeenLastCalledWith({ providerId: 'openai', apiKey: 'old-key' })
  })

  it('删除 Provider 后 settings 写入失败时恢复 Integration 凭据', async () => {
    let credential: string | null = JSON.stringify({ accessToken: 'old-token' })
    const { module, repository } = createModule({
      getProviderIntegrationCredential: vi.fn(async () => credential),
      saveProviderIntegrationCredential: vi.fn(async ({ value }: { value: string }) => { credential = value }),
      deleteProviderIntegrationCredential: vi.fn(async () => { credential = null }),
      deleteProviderApiKey: vi.fn(async () => {}),
    })
    vi.spyOn(repository, 'deleteProvider').mockImplementation(() => {
      throw new Error('settings unavailable')
    })

    await expect(module.deleteProvider({ id: 'codex' })).rejects.toThrow('settings unavailable')

    expect(credential).toBe(JSON.stringify({ accessToken: 'old-token' }))
    expect(repository.getProviderById('codex')).not.toBeNull()
  })

  it('deleteProvider 时 Keychain 删除失败保留可重试的 Provider，不留下孤儿凭据', async () => {
    const deleteProviderIntegrationCredential = vi.fn(async () => {
      throw new Error('keychain unavailable')
    })
    const { module, repository } = createModule({
      getProviderIntegrationCredential: vi.fn(async () => JSON.stringify({ accessToken: 'token' })),
      deleteProviderIntegrationCredential,
      deleteProviderApiKey: vi.fn(async () => {}),
    })

    await expect(module.deleteProvider({ id: 'codex' })).rejects.toThrow('keychain unavailable')
    // 凭据清理失败时配置必须仍存在，用户才能重试删除完成清理。
    expect(repository.getProviderById('codex')).not.toBeNull()
  })

  it('dispose 后在途 refresh 不能把新 token 写回 Keychain', async () => {
    const now = 1_000_000
    const saveProviderIntegrationCredential = vi.fn(async () => {})
    let releaseRefresh!: (response: Response) => void
    let refreshStarted!: () => void
    const started = new Promise<void>(resolve => refreshStarted = resolve)
    const refreshResponse = new Promise<Response>(resolve => releaseRefresh = resolve)
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      refreshStarted()
      return await refreshResponse
    })
    // fetch 必须在本模块构造前 stub，CodexAuthSession 在构造时绑定 globalThis.fetch。
    vi.stubGlobal('fetch', fetchImpl)
    const { module } = createModule({
      getProviderIntegrationCredential: vi.fn(async () => JSON.stringify({
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        expiresAt: now + 1_000,
      })),
      saveProviderIntegrationCredential,
      deleteProviderApiKey: vi.fn(async () => {}),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
    })

    const syncing = module.syncModels({ providerId: 'codex' })
    await started
    module.dispose()
    releaseRefresh(new Response(JSON.stringify({ access_token: 'new-token', expires_in: 3600 }), { status: 200 }))

    await expect(syncing).rejects.toThrow()
    expect(saveProviderIntegrationCredential).not.toHaveBeenCalled()
  })

  it('importLocalAuth 从 Codex CLI auth.json 导入凭据并写入 Keychain', async () => {
    let credential: string | null = null
    const { module } = createModule({
      getProviderIntegrationCredential: vi.fn(async () => credential),
      saveProviderIntegrationCredential: vi.fn(async ({ value }: { value: string }) => { credential = value }),
      deleteProviderIntegrationCredential: vi.fn(async () => { credential = null }),
      deleteProviderApiKey: vi.fn(async () => {}),
    })
    // Codex CLI 凭据路径为 $CODEX_HOME/auth.json（默认 ~/.codex/auth.json）。
    vi.stubEnv('CODEX_HOME', directory)
    await writeFile(join(directory, 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      last_refresh: new Date().toISOString(),
      tokens: {
        access_token: 'cli-access-token',
        refresh_token: 'cli-refresh-token',
        id_token: 'cli-id-token',
        account_id: 'cli-account',
      },
    }), 'utf8')

    const status = await module.importLocalAuth({ providerId: 'codex' })

    expect(status).toEqual(expect.objectContaining({ authenticated: true, state: 'usable' }))
    expect(credential).toContain('cli-access-token')
    module.dispose()
  })

  it('deleteProvider 清理会话后 dispose 可安全重复调用', async () => {
    const deleteProviderIntegrationCredential = vi.fn(async () => {})
    const { module } = createModule({
      getProviderIntegrationCredential: vi.fn(async () => JSON.stringify({ accessToken: 'token' })),
      deleteProviderIntegrationCredential,
      deleteProviderApiKey: vi.fn(async () => {}),
    })

    await module.deleteProvider({ id: 'codex' })
    expect(deleteProviderIntegrationCredential).toHaveBeenCalledWith({ providerId: 'codex', integrationId: 'codex-subscription' })
    expect(() => module.dispose()).not.toThrow()
    expect(() => module.dispose()).not.toThrow()
  })

  it('启动期拒绝持久化配置引用未注册的 Integration', () => {
    const repository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: join(directory, 'settings.json'),
      initialSettings: DEFAULT_APP_SETTINGS,
    }))
    const secretStore = {
      getProviderIntegrationCredential: vi.fn(async () => null),
      saveProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderApiKey: vi.fn(async () => {}),
    } as unknown as KeychainSecretStore
    // 故意不注册 codex-subscription，验证通用流程对未知 Integration 拒绝而不是兜底。
    expect(() => new ProviderModule(
      repository,
      secretStore,
      { emit: vi.fn() } as unknown as RuntimeEventBus,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SystemLogger,
    )).toThrow('未注册的 Integration')
  })

  it('启动期拒绝重复或覆盖内建 Integration 注册', () => {
    const repository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: join(directory, 'settings.json'),
      initialSettings: DEFAULT_APP_SETTINGS,
    }))
    const secretStore = {
      deleteProviderApiKey: vi.fn(async () => {}),
    } as unknown as KeychainSecretStore
    const duplicate = createCodexProviderIntegration({
      getProviderIntegrationCredential: vi.fn(async () => null),
      saveProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
    })

    expect(() => new ProviderModule(
      repository,
      secretStore,
      { emit: vi.fn() } as unknown as RuntimeEventBus,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SystemLogger,
      undefined,
      [['codex-subscription', duplicate], ['codex-subscription', duplicate]],
    )).toThrow('重复注册')
  })

  it('注册的 Integration 若声明 OAuth 却无 auth adapter 必须在构造期拒绝', () => {
    const repository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: join(directory, 'settings.json'),
      initialSettings: DEFAULT_APP_SETTINGS,
    }))
    const secretStore = {
      getProviderIntegrationCredential: vi.fn(async () => undefined),
      saveProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderIntegrationCredential: vi.fn(async () => {}),
      deleteProviderApiKey: vi.fn(async () => {}),
    } as unknown as KeychainSecretStore
    const inconsistent = {
      capabilities: {
        authentication: 'oauth' as const,
        modelSource: 'provider' as const,
        localAuthImport: false,
        usage: 'none' as const,
        endpoint: 'fixed' as const,
      },
      modelSource: { listModels: vi.fn(async () => []) },
      // 故意缺失 auth adapter，验证 capability 与可用方法不自相矛盾。
    } as unknown as ProviderIntegration

    expect(() => new ProviderModule(
      repository,
      secretStore,
      { emit: vi.fn() } as unknown as RuntimeEventBus,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SystemLogger,
      undefined,
      [['codex-subscription', inconsistent]],
    )).toThrow('没有 auth adapter')
  })
})
