import type { IModelResolver } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'

export const dbModelResolver: IModelResolver = {
  getModelById: async (id) => {
    return getAppDataServices().modelSettingsResolver.getModelById(id)
  },
  getProviderById: async (id) => {
    return getAppDataServices().modelSettingsResolver.getProviderById(id)
  },
}
