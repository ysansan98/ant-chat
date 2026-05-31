import type { AddServiceProviderModelSchema, AddServiceProviderSchema, AllAvailableModelsSchema, ModelsDevImportResult, ModelsDevModel, ModelsDevProvider, ServiceProviderModelsSchema, ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { ipc, isElectronRuntime, unwrapIpcResponse } from '@/utils/ipc-bus'
import { localRpc } from './transports/localWebTransport'

export const providerApi = {
  getAllProviderServices: async (): Promise<ServiceProviderSchema[]> => {
    if (!isElectronRuntime())
      return localRpc('provider.getAllProviderServices')
    return unwrapIpcResponse(await ipc.provider.getAllProviderServices())
  },

  addProviderService: async (config: AddServiceProviderSchema): Promise<ServiceProviderSchema> => {
    if (!isElectronRuntime())
      return localRpc('provider.addProviderServices', { config })
    return unwrapIpcResponse(await ipc.provider.addProviderServices(config))
  },

  updateProviderService: async (config: UpdateServiceProviderSchema): Promise<ServiceProviderSchema> => {
    if (!isElectronRuntime())
      return localRpc('provider.updateProviderService', { config })
    return unwrapIpcResponse(await ipc.provider.updateProviderService(config))
  },

  deleteProviderService: async (id: string): Promise<null> => {
    if (!isElectronRuntime())
      return localRpc('provider.deleteProviderService', { id })
    return unwrapIpcResponse(await ipc.provider.deleteProviderService(id))
  },

  getProviderServiceById: async (id: string): Promise<ServiceProviderSchema> => {
    if (!isElectronRuntime())
      return localRpc('provider.getProviderServicesById', { id })
    return unwrapIpcResponse(await ipc.provider.getProviderServicesById(id))
  },

  getProviderServiceByModelId: async (id: string): Promise<ServiceProviderSchema> => {
    if (!isElectronRuntime())
      return localRpc('provider.getProviderServiceByModelId', { id })
    return unwrapIpcResponse(await ipc.provider.getProviderServiceByModelId(id))
  },

  getAllAbvailableModels: async (): Promise<AllAvailableModelsSchema[]> => {
    if (!isElectronRuntime())
      return localRpc('provider.getAllAbvailableModels')
    return unwrapIpcResponse(await ipc.provider.getAllAbvailableModels())
  },

  getModelsByServiceProviderId: async (id: string): Promise<ServiceProviderModelsSchema[]> => {
    if (!isElectronRuntime())
      return localRpc('provider.getModelsByServiceProviderId', { id })
    return unwrapIpcResponse(await ipc.provider.getModelsByServiceProviderId(id))
  },

  setModelEnabledStatus: async (id: string, status: boolean): Promise<ServiceProviderModelsSchema> => {
    if (!isElectronRuntime())
      return localRpc('provider.setModelEnabledStatus', { id, status })
    return unwrapIpcResponse(await ipc.provider.setModelEnabledStatus(id, status))
  },

  addServiceProviderModel: async (config: AddServiceProviderModelSchema): Promise<ServiceProviderModelsSchema> => {
    if (!isElectronRuntime())
      return localRpc('provider.addProviderServiceModel', { config })
    return unwrapIpcResponse(await ipc.provider.addProviderServiceModel(config))
  },

  deleteServiceProviderModel: async (id: string): Promise<null> => {
    if (!isElectronRuntime())
      return localRpc('provider.deleteProviderServiceModel', { id })
    return unwrapIpcResponse(await ipc.provider.deleteProviderServiceModel(id))
  },

  getModelInfoById: async (id: string): Promise<ServiceProviderModelsSchema> => {
    if (!isElectronRuntime())
      return localRpc('provider.getModelById', { id })
    return unwrapIpcResponse(await ipc.provider.getModelById(id))
  },

  getModelsDevProviders: async (): Promise<ModelsDevProvider[]> => {
    if (!isElectronRuntime())
      return localRpc('provider.getModelsDevProviders')
    return unwrapIpcResponse(await ipc.provider.getModelsDevProviders())
  },

  getModelsDevModelsByProviderId: async (providerId: string): Promise<ModelsDevModel[]> => {
    if (!isElectronRuntime())
      return localRpc('provider.getModelsDevModelsByProviderId', { providerId })
    return unwrapIpcResponse(await ipc.provider.getModelsDevModelsByProviderId(providerId))
  },

  importModelsDevModels: async (providerId: string): Promise<ModelsDevImportResult> => {
    if (!isElectronRuntime())
      return localRpc('provider.importModelsDevModels', { providerId })
    return unwrapIpcResponse(await ipc.provider.importModelsDevModels(providerId))
  },
}
