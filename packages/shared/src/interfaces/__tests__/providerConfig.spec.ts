import { describe, expect, it } from 'vitest'
import { CreateProviderConfigSchema, UpdateProviderConfigSchema } from '../../schemas/providerConfig'
import { ProviderSettingsSchema } from '../../schemas/appSettings'

const apiKeyConfig = {
  name: '测试服务商',
  baseUrl: 'https://api.example.com',
  apiMode: 'openai' as const,
  integrationId: 'api-key' as const,
}

const codexConfig = {
  name: '我的 Codex',
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  apiMode: 'openai' as const,
  integrationId: 'codex-subscription' as const,
}

describe('provider 配置模型收紧', () => {
  it('create 和 update 公共输入剥离 owner-only 的 API Key secret ref', () => {
    const forgedRef = 'provider:provider-1:codex_oauth'

    const created = CreateProviderConfigSchema.parse({
      ...apiKeyConfig,
      apiKeySecretId: forgedRef,
    })
    const updated = UpdateProviderConfigSchema.parse({
      id: 'provider-1',
      apiKeySecretId: forgedRef,
    })

    expect(created).not.toHaveProperty('apiKeySecretId')
    expect(updated).not.toHaveProperty('apiKeySecretId')
  })

  it('create 必须显式声明 Integration', () => {
    const { integrationId: _integrationId, ...missingIntegration } = apiKeyConfig

    expect(() => CreateProviderConfigSchema.parse(missingIntegration)).toThrow()
  })

  it('create 配置不接受运行时派生的 capabilities', () => {
    const parsed = CreateProviderConfigSchema.parse({
      ...apiKeyConfig,
      capabilities: { authentication: 'oauth' as const, modelSource: 'provider' as const, localAuthImport: true, usage: 'quota' as const, endpoint: 'fixed' as const },
    })

    expect(parsed).not.toHaveProperty('capabilities')
  })

  it('update 配置不接受运行时派生的 capabilities', () => {
    const parsed = UpdateProviderConfigSchema.parse({
      id: 'provider-1',
      name: '重命名',
      capabilities: { authentication: 'oauth' as const, modelSource: 'provider' as const, localAuthImport: true, usage: 'quota' as const, endpoint: 'fixed' as const },
    })

    expect(parsed).not.toHaveProperty('capabilities')
  })

  it('持久化 settings 不保存 capabilities', () => {
    const parsed = ProviderSettingsSchema.parse({
      id: 'provider-1',
      name: '测试',
      baseUrl: 'https://api.example.com',
      apiMode: 'openai',
      integrationId: 'api-key',
      isOfficial: false,
      isEnabled: true,
      models: {},
      capabilities: { authentication: 'oauth', modelSource: 'provider', localAuthImport: true, usage: 'quota', endpoint: 'fixed' },
    })

    expect(parsed).not.toHaveProperty('capabilities')
  })

  it('codex 订阅合法组合（openai + 固定 endpoint）可以通过', () => {
    expect(CreateProviderConfigSchema.parse(codexConfig)).toMatchObject({
      integrationId: 'codex-subscription',
      apiMode: 'openai',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    })
  })
})
