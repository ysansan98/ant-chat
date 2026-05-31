import type { IModelCatalog } from '@ant-chat/shared'
import type { ProviderSettingsRepository } from './providerSettingsRepository'

export function createModelCatalog(repository: ProviderSettingsRepository): IModelCatalog {
  return {
    getModelById: async (id) => {
      const model = repository.getModelById(id)
      if (!model) {
        return null
      }
      return { id: model.id, model: model.model, name: model.name, providerId: model.providerId }
    },
    getProviderById: async (id) => {
      const provider = repository.getProviderById(id)
      if (!provider) {
        return null
      }
      return provider
    },
  }
}
