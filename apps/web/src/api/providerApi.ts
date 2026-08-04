import type { AllAvailableModelsSchema, CreateProviderConfigModelSchema, CreateProviderConfigSchema, ModelsDevProvider, ProviderAuthStatus, ProviderConfigModelSchema, ProviderIntegrationCatalogItem, ProviderPublicView, ProviderUsageStatus, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { emitProviderChanged } from '@/constants/providerEvents'
import { getAppRpcClient } from './transports/appRpc'

export const providerApi = {
  listProviders: async (): Promise<ProviderPublicView[]> => {
    return getAppRpcClient().call('provider.listProviders', undefined)
  },

  listIntegrations: async (): Promise<ProviderIntegrationCatalogItem[]> => {
    return getAppRpcClient().call('provider.listIntegrations', undefined)
  },

  createProvider: async (config: CreateProviderConfigSchema): Promise<ProviderPublicView> => {
    const result = await getAppRpcClient().call('provider.createProvider', { config })
    emitProviderChanged()
    return result
  },

  updateProvider: async (config: UpdateProviderConfigSchema): Promise<ProviderPublicView> => {
    const result = await getAppRpcClient().call('provider.updateProvider', { config })
    emitProviderChanged()
    return result
  },

  deleteProvider: async (id: string): Promise<null> => {
    const result = await getAppRpcClient().call('provider.deleteProvider', { id })
    emitProviderChanged()
    return result
  },

  getProviderById: async (id: string): Promise<ProviderPublicView> => {
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

  setModelEnabledStatus: async (providerId: string, modelId: string, status: boolean): Promise<ProviderConfigModelSchema> => {
    const result = await getAppRpcClient().call('provider.setModelEnabledStatus', { providerId, modelId, status })
    emitProviderChanged()
    return result
  },

  createProviderModel: async (config: CreateProviderConfigModelSchema): Promise<ProviderConfigModelSchema> => {
    const result = await getAppRpcClient().call('provider.createProviderModel', { config })
    emitProviderChanged()
    return result
  },

  deleteProviderModel: async (providerId: string, modelId: string): Promise<null> => {
    const result = await getAppRpcClient().call('provider.deleteProviderModel', { providerId, modelId })
    emitProviderChanged()
    return result
  },

  getModelsDevProviders: async (): Promise<ModelsDevProvider[]> => {
    return getAppRpcClient().call('provider.getModelsDevProviders', undefined)
  },

  syncModels: async (providerId: string): Promise<ProviderConfigModelSchema[]> => {
    const result = await getAppRpcClient().call('provider.syncModels', { providerId })
    emitProviderChanged()
    return result
  },

  startOAuthLogin: async (providerId: string): Promise<{ authorizationUrl: string }> => {
    return getAppRpcClient().call('provider.startOAuthLogin', { providerId })
  },

  importLocalAuth: async (providerId: string): Promise<ProviderAuthStatus> => {
    const result = await getAppRpcClient().call('provider.importLocalAuth', { providerId })
    emitProviderChanged()
    return result
  },

  getAuthStatus: async (providerId: string): Promise<ProviderAuthStatus> => {
    return getAppRpcClient().call('provider.getAuthStatus', { providerId })
  },

  getUsage: async (providerId: string): Promise<ProviderUsageStatus> => {
    return getAppRpcClient().call('provider.getUsage', { providerId })
  },

  logoutAuth: async (providerId: string): Promise<null> => {
    const result = await getAppRpcClient().call('provider.logoutAuth', { providerId })
    emitProviderChanged()
    return result
  },
}
