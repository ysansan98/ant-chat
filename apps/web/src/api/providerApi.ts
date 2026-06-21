import type { AllAvailableModelsSchema, CreateProviderConfigModelSchema, CreateProviderConfigSchema, ModelsDevImportResult, ModelsDevModel, ModelsDevProvider, ProviderConfigModelSchema, ProviderConfigSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { emitProviderChanged } from '@/constants/providerEvents'
import { getAppRpcClient } from './transports/appRpc'

export const providerApi = {
  listProviders: async (): Promise<ProviderConfigSchema[]> => {
    return getAppRpcClient().call('provider.listProviders', undefined)
  },

  createProvider: async (config: CreateProviderConfigSchema): Promise<ProviderConfigSchema> => {
    const result = await getAppRpcClient().call('provider.createProvider', { config })
    emitProviderChanged()
    return result
  },

  updateProvider: async (config: UpdateProviderConfigSchema): Promise<ProviderConfigSchema> => {
    const result = await getAppRpcClient().call('provider.updateProvider', { config })
    emitProviderChanged()
    return result
  },

  deleteProvider: async (id: string): Promise<null> => {
    const result = await getAppRpcClient().call('provider.deleteProvider', { id })
    emitProviderChanged()
    return result
  },

  getProviderById: async (id: string): Promise<ProviderConfigSchema> => {
    return getAppRpcClient().call('provider.getProviderById', { id })
  },

  getModelInfoById: async (modelId: string, providerId: string): Promise<ProviderConfigModelSchema> => {
    return getAppRpcClient().call('provider.getModel', { providerId, modelId })
  },

  getAllAbvailableModels: async (): Promise<AllAvailableModelsSchema[]> => {
    return getAppRpcClient().call('provider.getAllAbvailableModels', undefined)
  },

  listProviderModels: async (id: string): Promise<ProviderConfigModelSchema[]> => {
    return getAppRpcClient().call('provider.listProviderModels', { id })
  },

  setModelEnabledStatus: async (id: string, status: boolean): Promise<ProviderConfigModelSchema> => {
    const result = await getAppRpcClient().call('provider.setModelEnabledStatus', { id, status })
    emitProviderChanged()
    return result
  },

  createProviderModel: async (config: CreateProviderConfigModelSchema): Promise<ProviderConfigModelSchema> => {
    const result = await getAppRpcClient().call('provider.createProviderModel', { config })
    emitProviderChanged()
    return result
  },

  deleteProviderModel: async (id: string): Promise<null> => {
    const result = await getAppRpcClient().call('provider.deleteProviderModel', { id })
    emitProviderChanged()
    return result
  },

  getModelsDevProviders: async (): Promise<ModelsDevProvider[]> => {
    return getAppRpcClient().call('provider.getModelsDevProviders', undefined)
  },

  getModelsDevModelsByProviderId: async (providerId: string): Promise<ModelsDevModel[]> => {
    return getAppRpcClient().call('provider.getModelsDevModelsByProviderId', { providerId })
  },

  importModelsDevModels: async (providerId: string): Promise<ModelsDevImportResult> => {
    const result = await getAppRpcClient().call('provider.importModelsDevModels', { providerId })
    emitProviderChanged()
    return result
  },
}
