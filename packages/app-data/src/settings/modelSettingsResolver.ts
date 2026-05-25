import type { IModelResolver } from '@ant-chat/shared'
import type { ProviderSettingsRepository } from './providerSettingsRepository'

export function createModelSettingsResolver(repository: ProviderSettingsRepository): IModelResolver {
  return {
    getModelById: async (id) => {
      const model = repository.getModelById(id)
      if (!model) {
        return null
      }
      return { id: model.id, model: model.model, name: model.name, serviceProviderId: model.serviceProviderId }
    },
    getProviderById: async (id) => {
      const provider = repository.getProviderServiceById(id)
      if (!provider) {
        return null
      }
      return { id: provider.id, name: provider.name, apiKey: provider.apiKey, baseUrl: provider.baseUrl, apiMode: provider.apiMode }
    },
  }
}
