import type { IModelCatalog } from '@ant-chat/shared'
import type { ProviderSettingsRepository } from './providerSettingsRepository'

export function createModelCatalog(repository: ProviderSettingsRepository): IModelCatalog {
  return {
    resolveModel: async (ref) => {
      const resolved = repository.resolveModel(ref.providerId, ref.modelId)
      if (!resolved) {
        return null
      }
      return {
        model: {
          id: resolved.model.id,
          model: resolved.model.model,
          name: resolved.model.name,
          providerId: resolved.model.providerId,
          contextLength: resolved.model.contextLength,
        },
        provider: resolved.provider,
      }
    },
    getModel: async (providerId, modelId) => {
      const model = repository.getModel(providerId, modelId)
      if (!model) {
        return null
      }
      return {
        id: model.id,
        model: model.model,
        name: model.name,
        providerId: model.providerId,
        contextLength: model.contextLength,
      }
    },
    getProvider: async (id) => {
      const provider = repository.getProviderById(id)
      if (!provider) {
        return null
      }
      return provider
    },
  }
}
