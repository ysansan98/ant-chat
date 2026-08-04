import type { ModelsDevModel, ProviderConfigSchema } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import type { CodexBackendClient } from '../../../../agent-core/ai-providers/codex-backend-client'
import { createCodexModelSource, createCodexProviderIntegration } from '../codexIntegration'
import { createModelsDevModelSource } from '../providerIntegration'

const provider = {
  id: 'codex',
  name: 'OpenAI Codex',
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  apiMode: 'openai',
  integrationId: 'codex-subscription',
  isOfficial: true,
  isEnabled: false,
  createdAt: 0,
  updatedAt: 0,
} satisfies ProviderConfigSchema

describe('provider integration 行为', () => {
  it('codex 模型源返回私有 backend 的模型定义', async () => {
    const client = {
      listModels: vi.fn(async () => [{
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        contextLength: 256_000,
        maxOutputTokens: 16_000,
        capabilities: { reasoning: true },
      }]),
    } as unknown as CodexBackendClient
    const source = createCodexModelSource(() => client)

    await expect(source.listModels(provider)).resolves.toEqual([{
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      contextLength: 256_000,
      maxOutputTokens: 16_000,
      capabilities: { reasoning: true },
    }])
    expect(client.listModels).toHaveBeenCalledOnce()
  })

  it('通用模型源把 models.dev 定义映射成同一模型接口', async () => {
    const models: ModelsDevModel[] = [{
      id: 'gpt-4.1',
      name: 'GPT-4.1',
      providerId: 'openai',
      model: 'gpt-4.1',
      contextLength: 128_000,
      maxOutputTokens: 8_000,
      toolCall: true,
      reasoning: false,
      modalities: { input: ['text'], output: ['text'] },
    }]
    const source = createModelsDevModelSource(async () => models)

    await expect(source.listModels({ ...provider, id: 'openai', apiMode: 'openai' })).resolves.toMatchObject([{
      id: 'gpt-4.1',
      name: 'GPT-4.1',
      capabilities: {
        functionCall: true,
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    }])
  })

  it('订阅 Integration 暴露通用 OAuth 和 provider 模型源能力', () => {
    const integration = createCodexProviderIntegration({
      getProviderIntegrationCredential: vi.fn(),
      saveProviderIntegrationCredential: vi.fn(),
      deleteProviderIntegrationCredential: vi.fn(),
    })

    expect(integration.capabilities).toEqual({
      authentication: 'oauth',
      modelSource: 'provider',
      localAuthImport: true,
      usage: 'quota',
      endpoint: 'fixed',
      fixedBaseUrl: 'https://chatgpt.com/backend-api/codex',
    })
    expect(integration.auth).toBeDefined()
    expect(integration.getUsage).toBeDefined()
    expect(integration.createAIProvider).toBeDefined()
  })

  it('订阅 Integration 的 capability 与可用方法不自相矛盾', () => {
    const integration = createCodexProviderIntegration({
      getProviderIntegrationCredential: vi.fn(),
      saveProviderIntegrationCredential: vi.fn(),
      deleteProviderIntegrationCredential: vi.fn(),
    })

    // 声明 OAuth 必须有 auth adapter；声明 quota 必须有 getUsage。
    expect(integration.capabilities.authentication).toBe('oauth')
    expect(integration.auth).toBeDefined()
    expect(integration.capabilities.usage).toBe('quota')
    expect(integration.getUsage).toBeDefined()
  })
})
