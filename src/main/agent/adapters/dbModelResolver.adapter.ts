import type { IModelResolver } from '@ant-chat/shared'
import { getModelById, getProviderServiceById } from '@main/db/services'

export const dbModelResolver: IModelResolver = {
  getModelById: async (id) => {
    const model = await getModelById(id)
    if (!model)
      return null
    return { id: model.id, model: model.model, name: model.name, serviceProviderId: model.serviceProviderId }
  },
  getProviderById: async (id) => {
    const provider = getProviderServiceById(id)
    if (!provider)
      return null
    return { id: provider.id, name: provider.name, apiKey: provider.apiKey, baseUrl: provider.baseUrl, apiMode: provider.apiMode }
  },
}
