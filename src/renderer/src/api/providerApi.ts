import type { AddServiceProviderModelSchema, AddServiceProviderSchema, AllAvailableModelsSchema, ServiceProviderModelsSchema, ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'

export const providerApi = {
  getAllProviderServices: async (): Promise<ServiceProviderSchema[]> => {
    return unwrapIpcResponse(await ipc.provider.getAllProviderServices())
  },

  addProviderService: async (config: AddServiceProviderSchema): Promise<ServiceProviderSchema> => {
    return unwrapIpcResponse(await ipc.provider.addProviderServices(config))
  },

  updateProviderService: async (config: UpdateServiceProviderSchema): Promise<ServiceProviderSchema> => {
    return unwrapIpcResponse(await ipc.provider.updateProviderService(config))
  },

  deleteProviderService: async (id: string): Promise<null> => {
    return unwrapIpcResponse(await ipc.provider.deleteProviderService(id))
  },

  getProviderServiceById: async (id: string): Promise<ServiceProviderSchema> => {
    return unwrapIpcResponse(await ipc.provider.getProviderServicesById(id))
  },

  getProviderServiceByModelId: async (id: string): Promise<ServiceProviderSchema> => {
    return unwrapIpcResponse(await ipc.provider.getProviderServiceByModelId(id))
  },

  getAllAbvailableModels: async (): Promise<AllAvailableModelsSchema[]> => {
    return unwrapIpcResponse(await ipc.provider.getAllAbvailableModels())
  },

  getModelsByServiceProviderId: async (id: string): Promise<ServiceProviderModelsSchema[]> => {
    return unwrapIpcResponse(await ipc.provider.getModelsByServiceProviderId(id))
  },

  setModelEnabledStatus: async (id: string, status: boolean): Promise<ServiceProviderModelsSchema> => {
    return unwrapIpcResponse(await ipc.provider.setModelEnabledStatus(id, status))
  },

  addServiceProviderModel: async (config: AddServiceProviderModelSchema): Promise<ServiceProviderModelsSchema> => {
    return unwrapIpcResponse(await ipc.provider.addProviderServiceModel(config))
  },

  deleteServiceProviderModel: async (id: string): Promise<null> => {
    return unwrapIpcResponse(await ipc.provider.deleteProviderServiceModel(id))
  },

  getModelInfoById: async (id: string): Promise<ServiceProviderModelsSchema> => {
    return unwrapIpcResponse(await ipc.provider.getModelById(id))
  },
}
