import type { AllAvailableModelsSchema, CreateProviderConfigModelSchema, CreateProviderConfigSchema, IpcResponse, ModelsDevModel, ModelsDevProvider, ProviderConfigModelSchema, ProviderConfigSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/runtime/appRuntime'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class ProviderIpcService extends IpcService {
  static readonly groupName = 'provider'

  @IpcMethod()
  async listProviders(): Promise<IpcResponse<ProviderConfigSchema[]>> {
    try {
      const data = getAppRuntime().provider.list()
      return createIpcResponse(true, data)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async updateProvider(providerConfig: UpdateProviderConfigSchema): Promise<IpcResponse<ProviderConfigSchema>> {
    try {
      const updatedData = getAppRuntime().provider.update(providerConfig)
      return createIpcResponse(true, updatedData)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async createProvider(data: CreateProviderConfigSchema): Promise<IpcResponse<ProviderConfigSchema>> {
    try {
      const result = getAppRuntime().provider.create(data)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteProvider(id: string): Promise<IpcResponse<null>> {
    try {
      getAppRuntime().provider.delete(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getProviderById(id: string): Promise<IpcResponse<ProviderConfigSchema>> {
    try {
      const result = getAppRuntime().provider.getById(id)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getProviderByModelId(id: string): Promise<IpcResponse<ProviderConfigSchema>> {
    try {
      const result = getAppRuntime().provider.getByModelId(id)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getAllAbvailableModels(): Promise<IpcResponse<AllAvailableModelsSchema[]>> {
    try {
      const result = getAppRuntime().provider.listAvailableModels()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async listProviderModels(id: string): Promise<IpcResponse<ProviderConfigModelSchema[]>> {
    try {
      const result = getAppRuntime().provider.listModels(id)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelById(id: string): Promise<IpcResponse<ProviderConfigModelSchema>> {
    try {
      const result = getAppRuntime().provider.getModel(id)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async setModelEnabledStatus(id: string, status: boolean): Promise<IpcResponse<ProviderConfigModelSchema>> {
    try {
      const result = getAppRuntime().provider.setModelEnabled(id, status)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async createProviderModel(config: CreateProviderConfigModelSchema): Promise<IpcResponse<ProviderConfigModelSchema>> {
    try {
      const result = getAppRuntime().provider.createModel(config)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteProviderModel(id: string): Promise<IpcResponse<null>> {
    try {
      getAppRuntime().provider.deleteModel(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelsDevProviders(): Promise<IpcResponse<ModelsDevProvider[]>> {
    try {
      const result = await getAppRuntime().provider.getModelsDevProviders()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelsDevModelsByProviderId(providerId: string): Promise<IpcResponse<ModelsDevModel[]>> {
    try {
      const result = await getAppRuntime().provider.getModelsDevModels(providerId)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async importModelsDevModels(providerId: string): Promise<IpcResponse<{ added: string[], skipped: string[], duplicates: string[], errors: { model: string, reason: string }[] }>> {
    try {
      const result = await getAppRuntime().provider.importModelsDevModels(providerId)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }
}
