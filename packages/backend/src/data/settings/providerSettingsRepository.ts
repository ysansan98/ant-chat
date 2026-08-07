import type {
  AllAvailableModelsSchema,
  CreateProviderConfigModelSchema,
  CreateProviderConfigSchema,
  ProviderConfigModelSchema,
  ProviderConfigSchema,
  ProviderModelSettingsSchema,
  ProviderSettingsSchema,
  UpdateProviderConfigSchema,
} from '@ant-chat/shared'
import type { AppSettingsStore } from './appSettingsStore'
import { CreateProviderConfigModelSchema as CreateProviderConfigModelValidator, CreateProviderConfigSchema as CreateProviderConfigValidator, UpdateProviderConfigSchema as UpdateProviderConfigValidator } from '@ant-chat/shared'
import { nanoid } from 'nanoid'

export type CreateProviderSettingsInput = Omit<CreateProviderConfigSchema, 'apiKey'> & {
  apiKeySecretId?: string
}

export type UpdateProviderSettingsInput = Omit<UpdateProviderConfigSchema, 'apiKey'> & {
  apiKeySecretId?: string
}

export interface ProviderModelSyncInput {
  id: string
  name: string
  maxOutputTokens?: number
  contextLength?: number
  temperature?: number
  capabilities?: ProviderConfigModelSchema['capabilities']
  cost?: ProviderConfigModelSchema['cost']
}

function toProviderConfig(provider: ProviderSettingsSchema): ProviderConfigSchema {
  const { models: _models, ...providerConfig } = provider
  return { ...providerConfig, hasApiKey: Boolean(provider.apiKeySecretId), createdAt: 0, updatedAt: 0 }
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

  updateProvider(config: UpdateProviderSettingsInput): ProviderConfigSchema {
    const { apiKeySecretId, ...publicConfig } = config
    const data = UpdateProviderConfigValidator.parse(publicConfig)
    if (apiKeySecretId !== undefined) {
      assertProviderApiKeySecretRef(data.id, apiKeySecretId)
    }
    const hasApiKeySecretUpdate = Object.hasOwn(config, 'apiKeySecretId')
    let updatedProvider: ProviderSettingsSchema | null = null
    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        if (provider.id !== data.id) {
          return provider
        }
        updatedProvider = {
          ...provider,
          ...data,
          ...(hasApiKeySecretUpdate ? { apiKeySecretId } : {}),
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

  createProvider(config: CreateProviderSettingsInput): ProviderConfigSchema {
    const { apiKeySecretId, ...publicConfig } = config
    const data = CreateProviderConfigValidator.parse(publicConfig)
    const id = data.id ?? `provider-${nanoid()}`
    if (apiKeySecretId !== undefined) {
      assertProviderApiKeySecretRef(id, apiKeySecretId)
    }
    const createdProvider: ProviderSettingsSchema = {
      id,
      name: data.name,
      baseUrl: data.baseUrl,
      apiKeySecretId,
      apiMode: data.apiMode,
      // 产品订阅身份必须随配置持久化，否则运行时会回退成 API Key Integration。
      integrationId: data.integrationId,
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

  setModelEnabledStatus(providerId: string, modelId: string, status: boolean): ProviderConfigModelSchema {
    let updatedModel: ProviderConfigModelSchema | null = null
    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        if (provider.id !== providerId) {
          return provider
        }
        const currentModel = provider.models[modelId]
        if (!currentModel) {
          return provider
        }
        const nextModel = { ...currentModel, isEnabled: status }
        updatedModel = toProviderConfigModel(provider.id, modelId, nextModel)
        const models = { ...provider.models, [modelId]: nextModel }
        return { ...provider, models }
      })
      if (!updatedModel) {
        throw new Error(`Model not found: ${providerId}/${modelId}`)
      }
      return { ...settings, providers }
    })
    if (!updatedModel) {
      throw new Error(`Model not found: ${providerId}/${modelId}`)
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

  updateProviderModelCapabilities(providerId: string, modelId: string, capabilities: ProviderConfigModelSchema['capabilities']): ProviderConfigModelSchema {
    let updatedModel: ProviderConfigModelSchema | null = null
    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        if (provider.id !== providerId) {
          return provider
        }
        const currentModel = provider.models[modelId]
        if (!currentModel) {
          return provider
        }
        const nextModel = { ...currentModel, capabilities }
        updatedModel = toProviderConfigModel(providerId, modelId, nextModel)
        return { ...provider, models: { ...provider.models, [modelId]: nextModel } }
      })
      if (!settings.providers.some(provider => provider.id === providerId)) {
        throw new Error(`Provider not found: ${providerId}`)
      }
      return { ...settings, providers }
    })
    if (!updatedModel) {
      throw new Error(`Model not found: ${providerId}/${modelId}`)
    }
    return updatedModel
  }

  /**
   * 在一次 settings 写入中同步远端模型元数据。用户可见配置只从本地模型保留，
   * 远端下架模型不删除，避免一次目录波动破坏用户的会话选择。
   */
  syncProviderModels(providerId: string, inputModels: ProviderModelSyncInput[]): ProviderConfigModelSchema[] {
    const modelsById = new Map<string, ProviderModelSyncInput>()
    for (const model of inputModels) {
      // 同一来源重复 ID 采用首次出现；来源顺序固定时结果确定且可复现。
      if (!modelsById.has(model.id)) {
        modelsById.set(model.id, model)
      }
    }

    this.store.update((settings) => {
      const provider = settings.providers.find(item => item.id === providerId)
      if (!provider) {
        throw new Error(`Provider not found: ${providerId}`)
      }

      const models = { ...provider.models }
      for (const [modelId, remote] of modelsById) {
        const current = models[modelId]
        if (!current) {
          models[modelId] = {
            isEnabled: true,
            temperature: remote.temperature ?? 0.7,
            name: remote.name,
            maxOutputTokens: remote.maxOutputTokens ?? 4096,
            contextLength: remote.contextLength ?? 4096,
            capabilities: remote.capabilities,
            cost: remote.cost,
          }
          continue
        }

        models[modelId] = {
          ...current,
          // isEnabled、temperature、name 是用户配置，远端同步不得覆盖。
          maxOutputTokens: remote.maxOutputTokens ?? current.maxOutputTokens ?? 4096,
          contextLength: remote.contextLength ?? current.contextLength ?? 4096,
          capabilities: remote.capabilities ?? current.capabilities,
          cost: remote.cost ?? current.cost,
        }
      }

      return {
        ...settings,
        providers: settings.providers.map(item => item.id === providerId ? { ...item, models } : item),
      }
    })

    return this.listProviderModels(providerId)
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

  deleteProviderModel(providerId: string, modelId: string): void {
    let deleted = false
    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        if (provider.id !== providerId || !provider.models[modelId]) {
          return provider
        }
        const { [modelId]: _deletedModel, ...models } = provider.models
        deleted = true
        return { ...provider, models }
      })
      if (!deleted) {
        throw new Error(`Model not found: ${providerId}/${modelId}`)
      }
      return { ...settings, providers }
    })
  }
}

function getProviderApiKeyId(providerId: string): string {
  return `provider:${providerId}:api_key`
}

function assertProviderApiKeySecretRef(providerId: string, secretRefId: string): void {
  if (secretRefId !== getProviderApiKeyId(providerId)) {
    throw new Error(`Provider ${providerId} 的 API Key secret ref audience 不匹配。`)
  }
}
