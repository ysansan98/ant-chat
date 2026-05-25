import type {
  AddServiceProviderModelSchema,
  AddServiceProviderSchema,
  AllAvailableModelsSchema,
  ProviderModelSettingsSchema,
  ProviderSettingsSchema,
  ServiceProviderModelsSchema,
  ServiceProviderSchema,
  UpdateServiceProviderSchema,
} from '@ant-chat/shared'
import type { AppSettingsStore } from './appSettingsStore'
import { AddServiceProviderModelSchema as AddServiceProviderModelValidator, AddServiceProviderSchema as AddServiceProviderValidator, UpdateServiceProviderSchema as UpdateServiceProviderValidator } from '@ant-chat/shared'
import { nanoid } from 'nanoid'

function toServiceProvider(provider: ProviderSettingsSchema): ServiceProviderSchema {
  const { models: _models, ...serviceProvider } = provider
  return { ...serviceProvider, createdAt: 0, updatedAt: 0 }
}

function toServiceProviderModel(providerId: string, modelId: string, model: ProviderModelSettingsSchema): ServiceProviderModelsSchema {
  const overrides = model.overrides ?? {}
  return {
    id: modelId,
    model: modelId,
    name: overrides.name ?? modelId,
    isBuiltin: false,
    isEnabled: model.isEnabled,
    maxTokens: overrides.maxTokens ?? 4096,
    contextLength: overrides.contextLength ?? 4096,
    temperature: model.temperature ?? 0.7,
    modelFeatures: overrides.modelFeatures,
    serviceProviderId: providerId,
    createdAt: 0,
  }
}

export class ProviderSettingsRepository {
  constructor(private readonly store: AppSettingsStore) {}

  getAllProviderServices(): ServiceProviderSchema[] {
    return this.store.read().providers.map(toServiceProvider)
  }

  updateProviderService(config: UpdateServiceProviderSchema): ServiceProviderSchema {
    const data = UpdateServiceProviderValidator.parse(config)
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
    return toServiceProvider(updatedProvider)
  }

  addProviderService(config: AddServiceProviderSchema): ServiceProviderSchema {
    const data = AddServiceProviderValidator.parse(config)
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

    return toServiceProvider(createdProvider)
  }

  deleteProviderService(id: string): void {
    this.store.update(settings => ({
      ...settings,
      providers: settings.providers.filter(provider => provider.id !== id),
    }))
  }

  getProviderServiceById(id: string): ServiceProviderSchema | null {
    const provider = this.store.read().providers.find(provider => provider.id === id)
    return provider ? toServiceProvider(provider) : null
  }

  getProviderSettingsById(id: string): ProviderSettingsSchema | null {
    return this.store.read().providers.find(provider => provider.id === id) ?? null
  }

  getServiceProviderByModelId(id: string): ServiceProviderSchema | null {
    const provider = this.store.read().providers.find(provider => Boolean(provider.models[id]))
    return provider ? toServiceProvider(provider) : null
  }

  getAllAvailableModels(): AllAvailableModelsSchema[] {
    return this.store.read().providers.filter(provider => provider.isEnabled).map((provider) => {
      const { models, ...serviceProvider } = provider
      return {
        ...serviceProvider,
        models: Object.entries(models)
          .filter(([, model]) => model.isEnabled)
          .map(([modelId, model]) => toServiceProviderModel(provider.id, modelId, model)),
      }
    })
  }

  getModelsByServiceProviderId(providerServiceId: string): ServiceProviderModelsSchema[] {
    const provider = this.store.read().providers.find(provider => provider.id === providerServiceId)
    if (!provider) {
      return []
    }
    return Object.entries(provider.models).map(([modelId, model]) => toServiceProviderModel(provider.id, modelId, model))
  }

  setModelEnabledStatus(id: string, status: boolean): ServiceProviderModelsSchema {
    let updatedModel: ServiceProviderModelsSchema | null = null
    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        const currentModel = provider.models[id]
        if (!currentModel) {
          return provider
        }
        const nextModel = { ...currentModel, isEnabled: status }
        updatedModel = toServiceProviderModel(provider.id, id, nextModel)
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

  addServiceProviderModel(config: AddServiceProviderModelSchema): ServiceProviderModelsSchema {
    const data = AddServiceProviderModelValidator.parse(config)
    const createdModel: ProviderModelSettingsSchema = {
      isEnabled: true,
      temperature: data.temperature,
      overrides: {
        name: data.name,
        maxTokens: data.maxTokens,
        contextLength: data.contextLength,
        modelFeatures: data.modelFeatures,
      },
    }

    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        if (provider.id !== data.serviceProviderId) {
          return provider
        }
        if (provider.models[data.model]) {
          throw new Error(`${data.model} 已存在，不可重复添加`)
        }
        return { ...provider, models: { ...provider.models, [data.model]: createdModel } }
      })
      if (!settings.providers.some(provider => provider.id === data.serviceProviderId)) {
        throw new Error(`Provider not found: ${data.serviceProviderId}`)
      }
      return { ...settings, providers }
    })

    return toServiceProviderModel(data.serviceProviderId, data.model, createdModel)
  }

  addProviderModelReference(providerId: string, modelId: string, options: { temperature?: number } = {}): ServiceProviderModelsSchema {
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

    return toServiceProviderModel(providerId, modelId, createdModel)
  }

  deleteServiceProviderModel(id: string): void {
    this.store.update((settings) => {
      const providers = settings.providers.map((provider) => {
        const { [id]: _deletedModel, ...models } = provider.models
        return { ...provider, models }
      })
      return { ...settings, providers }
    })
  }

  getModelById(id: string): ServiceProviderModelsSchema | null {
    for (const provider of this.store.read().providers) {
      const model = provider.models[id]
      if (model) {
        return toServiceProviderModel(provider.id, id, model)
      }
    }
    return null
  }
}
