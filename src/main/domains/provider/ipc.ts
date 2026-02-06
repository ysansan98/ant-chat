import type { AddServiceProviderModelSchema, AddServiceProviderSchema, AllAvailableModelsSchema, IpcResponse, ServiceProviderModelsSchema, ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { services } from '@main/db'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class ProviderIpcService extends IpcService {
  static readonly groupName = 'provider'

  @IpcMethod()
  async getAllProviderServices(): Promise<IpcResponse<ServiceProviderSchema[]>> {
    try {
      const data = services.getAllProviderServices()
      return createIpcResponse(true, data)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async updateProviderService(serviceData: UpdateServiceProviderSchema): Promise<IpcResponse<ServiceProviderSchema>> {
    try {
      const updatedData = services.updateProviderService(serviceData)
      return createIpcResponse(true, updatedData)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addProviderServices(data: AddServiceProviderSchema): Promise<IpcResponse<ServiceProviderSchema>> {
    try {
      const result = services.addProviderService(data)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteProviderService(id: string): Promise<IpcResponse<null>> {
    try {
      await services.deleteProviderService(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getProviderServicesById(id: string): Promise<IpcResponse<ServiceProviderSchema>> {
    try {
      const result = services.getProviderServiceById(id)
      if (!result) {
        return createErrorIpcResponse(new Error('not found'))
      }
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getProviderServiceByModelId(id: string): Promise<IpcResponse<ServiceProviderSchema>> {
    try {
      const result = services.getServiceProviderByModelId(id)
      if (!result) {
        throw new Error('not found')
      }
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getAllAbvailableModels(): Promise<IpcResponse<AllAvailableModelsSchema[]>> {
    try {
      const result = await services.getAllAvailableModels()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelsByServiceProviderId(id: string): Promise<IpcResponse<ServiceProviderModelsSchema[]>> {
    try {
      const result = await services.getModelsByServiceProviderId(id)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelById(id: string): Promise<IpcResponse<ServiceProviderModelsSchema>> {
    try {
      const result = await services.getModelById(id)
      if (!result) {
        throw new Error('not found')
      }
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async setModelEnabledStatus(id: string, status: boolean): Promise<IpcResponse<ServiceProviderModelsSchema>> {
    try {
      const result = await services.setModelEnabledStatus(id, status)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addProviderServiceModel(config: AddServiceProviderModelSchema): Promise<IpcResponse<ServiceProviderModelsSchema>> {
    try {
      const result = await services.addServiceProviderModel(config)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteProviderServiceModel(id: string): Promise<IpcResponse<null>> {
    try {
      await services.deleteServiceProviderModel(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }
}
