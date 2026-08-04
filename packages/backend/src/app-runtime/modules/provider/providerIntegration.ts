import type { IAIProvider, ModelsDevModel, ProviderAuthStatus, ProviderCapabilities, ProviderConfigModelSchema, ProviderConfigSchema, ProviderFormat, ProviderIntegrationId, ProviderUsageStatus } from '@ant-chat/shared'

export interface ProviderModelDefinition {
  id: string
  name: string
  maxOutputTokens?: number
  contextLength?: number
  temperature?: number
  capabilities?: ProviderConfigModelSchema['capabilities']
  cost?: ProviderConfigModelSchema['cost']
}

export interface ProviderModelSource {
  listModels: (provider: ProviderConfigSchema) => Promise<ProviderModelDefinition[]>
}

export interface ProviderAuthAdapter {
  startLogin: (provider: ProviderConfigSchema, redirectUri: string) => { authorizationUrl: string }
  handleCallback: (params: URLSearchParams) => Promise<boolean>
  importLocalAuth?: (provider: ProviderConfigSchema) => Promise<ProviderAuthStatus>
  getStatus: (provider: ProviderConfigSchema) => Promise<ProviderAuthStatus>
  logout: (provider: ProviderConfigSchema) => Promise<void>
  dispose?: () => void
}

export interface PreparedCredentialRevocation {
  commit: () => Promise<void>
  rollback: () => Promise<void>
}

export interface ProviderIntegration {
  descriptor: {
    label: string
    defaultApiMode: ProviderFormat
    fixedApiMode?: ProviderFormat
  }
  capabilities: ProviderCapabilities
  modelSource: ProviderModelSource
  /** 校验合并后的完整 Provider 配置；厂商 endpoint/wire invariant 由 Integration 拥有。 */
  validateConfig: (provider: ProviderConfigSchema) => void
  /** 先快照再撤销；settings 提交失败时由 Integration 恢复自己的凭据和内存状态。 */
  prepareRevoke: (provider: ProviderConfigSchema) => Promise<PreparedCredentialRevocation>
  auth?: ProviderAuthAdapter
  createAIProvider?: (provider: ProviderConfigSchema) => Promise<IAIProvider>
  getUsage?: (provider: ProviderConfigSchema) => Promise<ProviderUsageStatus>
  /** 卸载单个 Provider 的内存状态（会话/coordinator），不删除持久化凭据。 */
  discard?: (providerId: string) => void
  /** 卸载整个 Integration：失效所有在途写回并释放内存状态。 */
  dispose?: () => void
}

export function createModelsDevModelSource(
  listModels: (providerId: string) => Promise<ModelsDevModel[]>,
): ProviderModelSource {
  return {
    async listModels(provider) {
      return (await listModels(provider.id)).map(toModelsDevModelDefinition)
    },
  }
}

export function createDefaultProviderIntegration(
  modelSource: ProviderModelSource,
  credentialStore: {
    getProviderApiKey: (providerId: string) => Promise<string | null>
    saveProviderApiKey: (input: { providerId: string, apiKey: string }) => Promise<unknown>
    deleteProviderApiKey: (providerId: string) => Promise<void>
  },
): ProviderIntegration {
  return {
    descriptor: { label: 'API Key', defaultApiMode: 'openai' },
    capabilities: {
      authentication: 'api-key',
      modelSource: 'models-dev',
      localAuthImport: false,
      usage: 'none',
      endpoint: 'custom',
    },
    modelSource,
    validateConfig(provider) {
      if (provider.integrationId !== 'api-key') {
        throw new Error(`API Key Integration 不接受 ${provider.integrationId} 配置。`)
      }
    },
    async prepareRevoke(provider) {
      const previous = await credentialStore.getProviderApiKey(provider.id)
      return {
        commit: () => credentialStore.deleteProviderApiKey(provider.id),
        rollback: async () => {
          if (previous === null) {
            await credentialStore.deleteProviderApiKey(provider.id)
          }
          else {
            await credentialStore.saveProviderApiKey({ providerId: provider.id, apiKey: previous })
          }
        },
      }
    },
  }
}

function toModelsDevModelDefinition(model: ModelsDevModel): ProviderModelDefinition {
  return {
    id: model.model,
    name: model.name,
    contextLength: model.contextLength,
    maxOutputTokens: model.maxOutputTokens,
    capabilities: {
      functionCall: model.toolCall ?? false,
      reasoning: model.reasoning ?? false,
      reasoningLevels: model.reasoningLevels,
      supportsTemperature: model.supportsTemperature ?? false,
      structuredOutput: model.structuredOutput ?? false,
      inputModalities: (model.modalities?.input ?? []) as NonNullable<ProviderConfigModelSchema['capabilities']>['inputModalities'],
      outputModalities: (model.modalities?.output ?? []) as NonNullable<ProviderConfigModelSchema['capabilities']>['outputModalities'],
    },
    cost: model.cost,
  }
}

/** 厂商 Integration 注册表；key 是 Integration 标识，注册发生在 composition root。 */
export type ProviderIntegrationRegistry = ReadonlyMap<ProviderIntegrationId, ProviderIntegration>
