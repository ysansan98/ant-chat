import type {
  AllAvailableModelsSchema,
  CreateProviderConfigModelSchema,
  CreateProviderConfigSchema,
  ProviderConfigModelSchema,
  ProviderConfigSchema,
  ProviderModelSettingsSchema,
  ProviderSettingsSchema,
  SecretStore,
  UpdateProviderConfigSchema,
} from '@ant-chat/shared'
import type { AppSettingsStore } from './appSettingsStore'
import { CreateProviderConfigModelSchema as CreateProviderConfigModelValidator, CreateProviderConfigSchema as CreateProviderConfigValidator, UpdateProviderConfigSchema as UpdateProviderConfigValidator } from '@ant-chat/shared'
import { nanoid } from 'nanoid'

function toProviderConfig(provider: ProviderSettingsSchema): ProviderConfigSchema {
  const { apiKey, models: _models, ...providerConfig } = provider
  return { ...providerConfig, hasApiKey: Boolean(provider.apiKeySecretId || apiKey), createdAt: 0, updatedAt: 0 }
}

function toProviderConfigModel(providerId: string, modelId: string, model: ProviderModelSettingsSchema): ProviderConfigModelSchema {
  return {
    id: modelId,
    model: modelId,
    name: model.name ?? modelId,
    isBuiltin: false,
    isEnabled: model.isEnabled,
    maxOutputTokens: model.maxOutputTokens ?? 4096,
    contextLength: model.contextLength ?? 4096,
    temperature: model.temperature ?? 0.7,
    capabilities: model.capabilities,
    cost: model.cost,
    providerId,
    createdAt: 0,
  }
}

export class ProviderSettingsRepository {
  constructor(private readonly store: AppSettingsStore) {}

  listProviders(): ProviderConfigSchema[] {
    return this.store.read().providers.map(toProviderConfig)
  }

  updateProvider(config: UpdateProviderConfigSchema): ProviderConfigSchema {
    const data = UpdateProviderConfigValidator.parse(config)
    let updatedProvider: ProviderSettingsSchema | null = null
    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        if (provider.id !== data.id) {
          return provider
        }
        updatedProvider = {
          ...provider,
          ...data,
        }
        return updatedProvider
      })
      if (!updatedProvider) {
        throw new Error(`Provider not found: ${data.id}`)
      }
      return { ...settings, providers }
    })
    if (!updatedProvider) {
      throw new Error(`Provider not found: ${data.id}`)
    }
    return toProviderConfig(updatedProvider)
  }

  createProvider(config: CreateProviderConfigSchema): ProviderConfigSchema {
    const data = CreateProviderConfigValidator.parse(config)
    const id = data.id ?? `provider-${nanoid()}`
    const apiKeySecretId = data.apiKeySecretId ?? (data.apiKey ? getProviderApiKeyId(id) : undefined)
    const createdProvider: ProviderSettingsSchema = {
      id,
      name: data.name,
      baseUrl: data.baseUrl,
      apiKeySecretId,
      apiMode: data.apiMode,
      isOfficial: false,
      isEnabled: data.isEnabled ?? false,
      models: {},
    }

    this.store.update((settings) => {
      if (settings.providers.some(provider => provider.id === createdProvider.id)) {
        throw new Error(`Provider already exists: ${createdProvider.id}`)
      }
      return { ...settings, providers: [...settings.providers, createdProvider] }
    })

    return toProviderConfig(createdProvider)
  }

  deleteProvider(id: string): void {
    this.store.update(settings => ({
      ...settings,
      providers: settings.providers.filter(provider => provider.id !== id),
    }))
  }

  getProviderById(id: string): ProviderConfigSchema | null {
    const provider = this.store.read().providers.find(provider => provider.id === id)
    return provider ? toProviderConfig(provider) : null
  }

  getProviderSettingsById(id: string): ProviderSettingsSchema | null {
    return this.store.read().providers.find(provider => provider.id === id) ?? null
  }

  /**
   * 旧版 settings.json 将 API Key 明文写入配置。迁移先写入 Keychain，再在同一
   * settings 更新中替换为引用；写入失败时保留原值，避免丢失用户凭证。
   */
  async migratePlaintextApiKeys(secretStore: Pick<SecretStore, 'saveProviderApiKey'>): Promise<number> {
    const legacyProviders = this.store.read().providers.filter(provider => Boolean(provider.apiKey))
    if (legacyProviders.length === 0) {
      return 0
    }

    const migrated = new Map<string, string>()
    for (const provider of legacyProviders) {
      const ref = await secretStore.saveProviderApiKey({ providerId: provider.id, apiKey: provider.apiKey! })
      migrated.set(provider.id, ref.id)
    }

    this.store.update(settings => ({
      ...settings,
      providers: settings.providers.map((provider) => {
        const apiKeySecretId = migrated.get(provider.id)
        if (!apiKeySecretId) {
          return provider
        }
        const { apiKey: _apiKey, ...safeProvider } = provider
        return { ...safeProvider, apiKeySecretId }
      }),
    }))
    return migrated.size
  }

  getModel(providerId: string, modelId: string): ProviderConfigModelSchema | null {
    if (!providerId && modelId) {
      const legacy = this.findModelByModelId(modelId)
      return legacy ? toProviderConfigModel(legacy.provider.id, modelId, legacy.model) : null
    }
    const provider = this.store.read().providers.find(p => p.id === providerId)
    if (!provider)
      return null
    const model = provider.models[modelId]
    return model ? toProviderConfigModel(providerId, modelId, model) : null
  }

  resolveModel(providerId: string, modelId: string): { model: ProviderConfigModelSchema, provider: ProviderConfigSchema } | null {
    if (!providerId && modelId) {
      const legacy = this.findModelByModelId(modelId)
      if (!legacy)
        return null
      return {
        model: toProviderConfigModel(legacy.provider.id, modelId, legacy.model),
        provider: toProviderConfig(legacy.provider),
      }
    }
    const provider = this.store.read().providers.find(p => p.id === providerId)
    if (!provider)
      return null
    const model = provider.models[modelId]
    if (!model)
      return null
    return {
      model: toProviderConfigModel(providerId, modelId, model),
      provider: toProviderConfig(provider),
    }
  }

  /**
   * 旧会话数据只有 modelId、没有 providerId（升级前未拆分）。
   * 在 providerId 为空时，按 modelId 跨已启用 provider 无歧义回退：
   * 恰好 1 个已启用 provider 拥有该 modelId 才命中，0 个或多个则返回 null（保持报错，避免猜错）。
   */
  private findModelByModelId(modelId: string): { provider: ProviderSettingsSchema, model: ProviderModelSettingsSchema } | null {
    const matches = this.store.read().providers.filter(p => p.isEnabled && p.models[modelId])
    if (matches.length !== 1)
      return null
    return { provider: matches[0], model: matches[0].models[modelId] }
  }

  getAllAvailableModels(): AllAvailableModelsSchema[] {
    return this.store.read().providers.filter(provider => provider.isEnabled).map((provider) => {
      const { models, ...providerConfig } = provider
      return {
        ...providerConfig,
        models: Object.entries(models)
          .filter(([, model]) => model.isEnabled)
          .map(([modelId, model]) => toProviderConfigModel(provider.id, modelId, model)),
      }
    })
  }

  listProviderModels(providerId: string): ProviderConfigModelSchema[] {
    const provider = this.store.read().providers.find(provider => provider.id === providerId)
    if (!provider) {
      return []
    }
    return Object.entries(provider.models).map(([modelId, model]) => toProviderConfigModel(provider.id, modelId, model))
  }

  setModelEnabledStatus(id: string, status: boolean): ProviderConfigModelSchema {
    let updatedModel: ProviderConfigModelSchema | null = null
    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        const currentModel = provider.models[id]
        if (!currentModel) {
          return provider
        }
        const nextModel = { ...currentModel, isEnabled: status }
        updatedModel = toProviderConfigModel(provider.id, id, nextModel)
        const models = { ...provider.models, [id]: nextModel }
        return { ...provider, models }
      })
      if (!updatedModel) {
        throw new Error(`Model not found: ${id}`)
      }
      return { ...settings, providers }
    })
    if (!updatedModel) {
      throw new Error(`Model not found: ${id}`)
    }
    return updatedModel
  }

  createProviderModel(config: CreateProviderConfigModelSchema): ProviderConfigModelSchema {
    const data = CreateProviderConfigModelValidator.parse(config)
    const createdModel: ProviderModelSettingsSchema = {
      isEnabled: true,
      temperature: data.temperature,
      name: data.name,
      maxOutputTokens: data.maxOutputTokens,
      contextLength: data.contextLength,
      capabilities: data.capabilities,
      cost: data.cost,
    }

    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        if (provider.id !== data.providerId) {
          return provider
        }
        if (provider.models[data.model]) {
          throw new Error(`${data.model} 已存在，不可重复添加`)
        }
        return { ...provider, models: { ...provider.models, [data.model]: createdModel } }
      })
      if (!settings.providers.some(provider => provider.id === data.providerId)) {
        throw new Error(`Provider not found: ${data.providerId}`)
      }
      return { ...settings, providers }
    })

    return toProviderConfigModel(data.providerId, data.model, createdModel)
  }

  addProviderModelReference(providerId: string, modelId: string, options: { temperature?: number } = {}): ProviderConfigModelSchema {
    const createdModel: ProviderModelSettingsSchema = {
      isEnabled: true,
      temperature: options.temperature,
    }

    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        if (provider.id !== providerId) {
          return provider
        }
        if (provider.models[modelId]) {
          throw new Error(`${modelId} 已存在，不可重复添加`)
        }
        return { ...provider, models: { ...provider.models, [modelId]: createdModel } }
      })
      if (!settings.providers.some(provider => provider.id === providerId)) {
        throw new Error(`Provider not found: ${providerId}`)
      }
      return { ...settings, providers }
    })

    return toProviderConfigModel(providerId, modelId, createdModel)
  }

  deleteProviderModel(id: string): void {
    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        const { [id]: _deletedModel, ...models } = provider.models
        return { ...provider, models }
      })
      return { ...settings, providers }
    })
  }
}

function getProviderApiKeyId(providerId: string): string {
  return `provider:${providerId}:api_key`
}
