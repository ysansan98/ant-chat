import type { AddServiceProviderModelSchema, AddServiceProviderSchema, AllAvailableModelsSchema, ModelsDevImportResult, ModelsDevModel, ModelsDevProvider, ServiceProviderModelsSchema, ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

export const providerApi = {
  getAllProviderServices: async (): Promise<ServiceProviderSchema[]> => {
    return (await getAppTransport()).provider.getAllProviderServices()
  },

  addProviderService: async (config: AddServiceProviderSchema): Promise<ServiceProviderSchema> => {
    return (await getAppTransport()).provider.addProviderService(config)
  },

  updateProviderService: async (config: UpdateServiceProviderSchema): Promise<ServiceProviderSchema> => {
    return (await getAppTransport()).provider.updateProviderService(config)
  },

  deleteProviderService: async (id: string): Promise<null> => {
    return (await getAppTransport()).provider.deleteProviderService(id)
  },

  getProviderServiceById: async (id: string): Promise<ServiceProviderSchema> => {
    return (await getAppTransport()).provider.getProviderServiceById(id)
  },

  getProviderServiceByModelId: async (id: string): Promise<ServiceProviderSchema> => {
    return (await getAppTransport()).provider.getProviderServiceByModelId(id)
  },

  getAllAbvailableModels: async (): Promise<AllAvailableModelsSchema[]> => {
    return (await getAppTransport()).provider.getAllAbvailableModels()
  },

  getModelsByServiceProviderId: async (id: string): Promise<ServiceProviderModelsSchema[]> => {
    return (await getAppTransport()).provider.getModelsByServiceProviderId(id)
  },

  setModelEnabledStatus: async (id: string, status: boolean): Promise<ServiceProviderModelsSchema> => {
    return (await getAppTransport()).provider.setModelEnabledStatus(id, status)
  },

  addServiceProviderModel: async (config: AddServiceProviderModelSchema): Promise<ServiceProviderModelsSchema> => {
    return (await getAppTransport()).provider.addServiceProviderModel(config)
  },

  deleteServiceProviderModel: async (id: string): Promise<null> => {
    return (await getAppTransport()).provider.deleteServiceProviderModel(id)
  },

  getModelInfoById: async (id: string): Promise<ServiceProviderModelsSchema> => {
    return (await getAppTransport()).provider.getModelInfoById(id)
  },

  getModelsDevProviders: async (): Promise<ModelsDevProvider[]> => {
    return (await getAppTransport()).provider.getModelsDevProviders()
  },

  getModelsDevModelsByProviderId: async (providerId: string): Promise<ModelsDevModel[]> => {
    return (await getAppTransport()).provider.getModelsDevModelsByProviderId(providerId)
  },

  importModelsDevModels: async (providerId: string): Promise<ModelsDevImportResult> => {
    return (await getAppTransport()).provider.importModelsDevModels(providerId)
  },
}
