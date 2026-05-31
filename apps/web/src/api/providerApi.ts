import type { AllAvailableModelsSchema, CreateProviderConfigModelSchema, CreateProviderConfigSchema, ModelsDevImportResult, ModelsDevModel, ModelsDevProvider, ProviderConfigModelSchema, ProviderConfigSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

export const providerApi = {
  listProviders: async (): Promise<ProviderConfigSchema[]> => {
    return (await getAppTransport()).provider.listProviders()
  },

  createProvider: async (config: CreateProviderConfigSchema): Promise<ProviderConfigSchema> => {
    return (await getAppTransport()).provider.createProvider(config)
  },

  updateProvider: async (config: UpdateProviderConfigSchema): Promise<ProviderConfigSchema> => {
    return (await getAppTransport()).provider.updateProvider(config)
  },

  deleteProvider: async (id: string): Promise<null> => {
    return (await getAppTransport()).provider.deleteProvider(id)
  },

  getProviderById: async (id: string): Promise<ProviderConfigSchema> => {
    return (await getAppTransport()).provider.getProviderById(id)
  },

  getProviderByModelId: async (id: string): Promise<ProviderConfigSchema> => {
    return (await getAppTransport()).provider.getProviderByModelId(id)
  },

  getAllAbvailableModels: async (): Promise<AllAvailableModelsSchema[]> => {
    return (await getAppTransport()).provider.getAllAbvailableModels()
  },

  listProviderModels: async (id: string): Promise<ProviderConfigModelSchema[]> => {
    return (await getAppTransport()).provider.listProviderModels(id)
  },

  setModelEnabledStatus: async (id: string, status: boolean): Promise<ProviderConfigModelSchema> => {
    return (await getAppTransport()).provider.setModelEnabledStatus(id, status)
  },

  createProviderModel: async (config: CreateProviderConfigModelSchema): Promise<ProviderConfigModelSchema> => {
    return (await getAppTransport()).provider.createProviderModel(config)
  },

  deleteProviderModel: async (id: string): Promise<null> => {
    return (await getAppTransport()).provider.deleteProviderModel(id)
  },

  getModelInfoById: async (id: string): Promise<ProviderConfigModelSchema> => {
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
