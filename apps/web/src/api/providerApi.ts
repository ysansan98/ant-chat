import type { AllAvailableModelsSchema, CreateProviderConfigModelSchema, CreateProviderConfigSchema, ModelsDevImportResult, ModelsDevModel, ModelsDevProvider, ProviderConfigModelSchema, ProviderConfigSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { emitProviderChanged } from '@/constants/providerEvents'
import { getAppTransport } from './transports/appTransport'

export const providerApi = {
  listProviders: async (): Promise<ProviderConfigSchema[]> => {
    return (await getAppTransport()).provider.listProviders()
  },

  createProvider: async (config: CreateProviderConfigSchema): Promise<ProviderConfigSchema> => {
    const result = await (await getAppTransport()).provider.createProvider(config)
    emitProviderChanged()
    return result
  },

  updateProvider: async (config: UpdateProviderConfigSchema): Promise<ProviderConfigSchema> => {
    const result = await (await getAppTransport()).provider.updateProvider(config)
    emitProviderChanged()
    return result
  },

  deleteProvider: async (id: string): Promise<null> => {
    const result = await (await getAppTransport()).provider.deleteProvider(id)
    emitProviderChanged()
    return result
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
    const result = await (await getAppTransport()).provider.setModelEnabledStatus(id, status)
    emitProviderChanged()
    return result
  },

  createProviderModel: async (config: CreateProviderConfigModelSchema): Promise<ProviderConfigModelSchema> => {
    const result = await (await getAppTransport()).provider.createProviderModel(config)
    emitProviderChanged()
    return result
  },

  deleteProviderModel: async (id: string): Promise<null> => {
    const result = await (await getAppTransport()).provider.deleteProviderModel(id)
    emitProviderChanged()
    return result
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
