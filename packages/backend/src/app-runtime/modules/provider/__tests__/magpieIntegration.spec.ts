import type { ProviderConfigSchema } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  createMagpieProviderIntegration,
  MAGPIE_DEFAULT_API_KEY,
  MAGPIE_DEFAULT_BASE_URL,
  readConfiguredPort,
  resolveMagpieConfigPaths,
  toProviderModelDefinition,
} from '../magpieIntegration'

const provider: ProviderConfigSchema = {
  id: 'magpie',
  name: 'Magpie',
  baseUrl: MAGPIE_DEFAULT_BASE_URL,
  apiMode: 'openai',
  integrationId: 'magpie',
  isOfficial: false,
  isEnabled: true,
  createdAt: 0,
  updatedAt: 0,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function createCredentials(apiKey: string | null = null) {
  return {
    getProviderApiKey: vi.fn(async () => apiKey),
    saveProviderApiKey: vi.fn(async () => ({ kind: 'secret_ref' as const, id: 'provider:magpie:api_key', scope: 'persistent' as const })),
    deleteProviderApiKey: vi.fn(async () => {}),
  }
}

function createIntegration(
  fetchImpl: typeof fetch,
  options: {
    configPaths?: string[]
    readSettingsFile?: (filePath: string) => Promise<string | null>
    credentialStore?: ReturnType<typeof createCredentials>
  } = {},
) {
  const credentialStore = options.credentialStore ?? createCredentials()
  return {
    credentialStore,
    integration: createMagpieProviderIntegration(
      { credentialStore, clientInfo: { name: 'ant-chat', version: 'test' } },
      {
        fetchImpl,
        configPaths: options.configPaths ?? [],
        readSettingsFile: options.readSettingsFile ?? (async () => null),
      },
    ),
  }
}

describe('magpie 模型目录', () => {
  it('把网关模型映射为 Provider 模型定义', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      object: 'list',
      data: [
        {
          id: 'anthropic/claude-sonnet-5',
          display_name: 'Claude Sonnet 5',
          context_window: 200_000,
          max_output_tokens: 64_000,
          reasoning: true,
          supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'max' }],
          modalities: { input: ['text', 'image'] },
        },
        { id: 'ollama/llama3' },
      ],
    }))
    const { integration } = createIntegration(fetchImpl)

    const models = await integration.modelSource.listModels(provider)

    expect(models[0]).toEqual(expect.objectContaining({
      id: 'anthropic/claude-sonnet-5',
      name: 'Claude Sonnet 5',
      contextLength: 200_000,
      maxOutputTokens: 64_000,
      capabilities: expect.objectContaining({
        reasoning: true,
        reasoningLevels: ['low', 'medium', 'xhigh'],
        inputModalities: ['text', 'image'],
      }),
    }))
    expect(models[1]).toEqual(expect.objectContaining({ id: 'ollama/llama3', name: 'ollama/llama3' }))
  })

  it('请求地址来自 Provider 配置，带默认应用标识', async () => {
    const seen: Array<{ url: string, authorization: string | null }> = []
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      seen.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      })
      return jsonResponse({ data: [{ id: 'openai/gpt-5' }] })
    })
    const { integration } = createIntegration(fetchImpl)

    await integration.modelSource.listModels({ ...provider, baseUrl: 'http://127.0.0.1:4000/v1/' })

    expect(seen).toEqual([{
      url: 'http://127.0.0.1:4000/v1/models',
      authorization: `Bearer ${MAGPIE_DEFAULT_API_KEY}`,
    }])
  })

  it('用户配置密钥时用用户密钥', async () => {
    let authorization: string | null = null
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization')
      return jsonResponse({ data: [{ id: 'openai/gpt-5' }] })
    })
    const { integration } = createIntegration(fetchImpl, { credentialStore: createCredentials('magpie-custom-app') })

    await integration.modelSource.listModels(provider)

    expect(authorization).toBe('Bearer magpie-custom-app')
  })

  it('magpie 未运行时给出可读错误', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3425')
    })
    const { integration } = createIntegration(fetchImpl)

    await expect(integration.modelSource.listModels(provider))
      .rejects
      .toThrow(/无法连接 magpie 网关/)
  })

  it('网关拒绝请求时指向密钥配置', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'unauthorized' }, 401))
    const { integration } = createIntegration(fetchImpl)

    await expect(integration.modelSource.listModels(provider))
      .rejects
      .toThrow(/检查该服务商的 API Key/)
  })

  it('没有可用模型时报错而不是返回空列表', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ object: 'list', data: [] }))
    const { integration } = createIntegration(fetchImpl)

    await expect(integration.modelSource.listModels(provider))
      .rejects
      .toThrow(/没有可用模型/)
  })

  it('丢弃无法映射的条目', () => {
    expect(toProviderModelDefinition({ display_name: '没有 id' })).toBeNull()
    expect(toProviderModelDefinition(null)).toBeNull()
    expect(toProviderModelDefinition({ id: '  ' })).toBeNull()
  })
})

describe('magpie 探测', () => {
  it('探测到 magpie 时返回版本与地址', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe('http://127.0.0.1:3425/api/hello')
      return jsonResponse({ name: 'magpie', version: '1.2.3' })
    })
    const { integration } = createIntegration(fetchImpl)

    await expect(integration.probe!(provider)).resolves.toEqual({
      id: 'magpie',
      label: 'Magpie',
      available: true,
      version: '1.2.3',
      baseUrl: MAGPIE_DEFAULT_BASE_URL,
    })
  })

  it('把 settings.json 的端口作为候选地址', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === 'http://127.0.0.1:4000/api/hello') {
        return jsonResponse({ name: 'magpie', version: '2.0.0' })
      }
      throw new Error('connect ECONNREFUSED')
    })
    const { integration } = createIntegration(fetchImpl, {
      configPaths: ['/tmp/magpie/settings.json'],
      readSettingsFile: async () => JSON.stringify({ port: 4000 }),
    })

    await expect(integration.probe!(provider)).resolves.toEqual({
      id: 'magpie',
      label: 'Magpie',
      available: true,
      version: '2.0.0',
      baseUrl: 'http://127.0.0.1:4000/v1',
    })
  })

  it('全部候选都不通时报告不可用', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const { integration } = createIntegration(fetchImpl)

    await expect(integration.probe!(provider)).resolves.toEqual({
      id: 'magpie',
      label: 'Magpie',
      available: false,
    })
  })

  it('对端不是 magpie 时报告不可用', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ name: 'something-else', version: '1.0.0' }))
    const { integration } = createIntegration(fetchImpl)

    await expect(integration.probe!(provider)).resolves.toMatchObject({ available: false })
  })
})

describe('magpie 配置校验', () => {
  it('拒绝非 magpie 的配置', () => {
    const { integration } = createIntegration(vi.fn<typeof fetch>())
    expect(() => integration.validateConfig({ ...provider, integrationId: 'api-key' }))
      .toThrow(/不接受 api-key 配置/)
  })

  it('拒绝非 openai wire protocol', () => {
    const { integration } = createIntegration(vi.fn<typeof fetch>())
    expect(() => integration.validateConfig({ ...provider, apiMode: 'anthropic' }))
      .toThrow(/仅支持 openai wire protocol/)
  })

  it('接受默认配置', () => {
    const { integration } = createIntegration(vi.fn<typeof fetch>())
    expect(() => integration.validateConfig(provider)).not.toThrow()
  })
})

describe('magpie 凭据', () => {
  it('未配置密钥时仍能构造 AI Provider', async () => {
    const { integration } = createIntegration(vi.fn<typeof fetch>())

    await expect(integration.createAIProvider!(provider)).resolves.toBeDefined()
  })

  it('撤销时恢复原有密钥', async () => {
    const { integration, credentialStore } = createIntegration(vi.fn<typeof fetch>(), {
      credentialStore: createCredentials('magpie-custom-app'),
    })

    const revocation = await integration.prepareRevoke(provider)
    await revocation.commit()
    expect(credentialStore.deleteProviderApiKey).toHaveBeenCalledWith('magpie')

    await revocation.rollback()
    expect(credentialStore.saveProviderApiKey).toHaveBeenCalledWith({ providerId: 'magpie', apiKey: 'magpie-custom-app' })
  })
})

describe('magpie settings.json 读取', () => {
  it('忽略非法 JSON 与越界端口', async () => {
    await expect(readConfiguredPort(async () => 'not json', ['a'])).resolves.toBeNull()
    await expect(readConfiguredPort(async () => JSON.stringify({ port: 70_000 }), ['a'])).resolves.toBeNull()
    await expect(readConfiguredPort(async () => JSON.stringify({ port: '4000' }), ['a'])).resolves.toBeNull()
    await expect(readConfiguredPort(async () => null, ['a'])).resolves.toBeNull()
    await expect(readConfiguredPort(async () => JSON.stringify({ port: 4000 }), ['a'])).resolves.toBe(4000)
  })

  it('候选路径覆盖 XDG 与平台配置目录', () => {
    const paths = resolveMagpieConfigPaths(
      { XDG_CONFIG_HOME: '/xdg', APPDATA: '/appdata' },
      '/home/me',
    )

    expect(paths).toEqual([
      '/xdg/magpie/settings.json',
      '/home/me/.config/magpie/settings.json',
      '/home/me/Library/Application Support/magpie/settings.json',
      '/appdata/magpie/settings.json',
    ])
  })
})
