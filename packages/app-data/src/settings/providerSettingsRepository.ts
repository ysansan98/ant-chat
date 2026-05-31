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

function toProviderConfig(provider: ProviderSettingsSchema): ProviderConfigSchema {
  const { models: _models, ...providerConfig } = provider
  return { ...providerConfig, createdAt: 0, updatedAt: 0 }
}

function toProviderConfigModel(providerId: string, modelId: string, model: ProviderModelSettingsSchema): ProviderConfigModelSchema {
  return {
    id: modelId,
    model: modelId,
    name: model.name ?? modelId,
    isBuiltin: false,
    isEnabled: model.isEnabled,
    maxTokens: model.maxTokens ?? 4096,
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
    const createdProvider: ProviderSettingsSchema = {
      id: data.id ?? `provider-${nanoid()}`,
      name: data.name,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
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

  getProviderByModelId(id: string): ProviderConfigSchema | null {
    const provider = this.store.read().providers.find(provider => Boolean(provider.models[id]))
    return provider ? toProviderConfig(provider) : null
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
      maxTokens: data.maxTokens,
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

  getModelById(id: string): ProviderConfigModelSchema | null {
    for (const provider of this.store.read().providers) {
      const model = provider.models[id]
      if (model) {
        return toProviderConfigModel(provider.id, id, model)
      }
    }
    return null
  }
}
