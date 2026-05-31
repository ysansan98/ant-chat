import type { ModelsDevModel, ModelsDevProvider } from '@ant-chat/agent-runtime'
import type { AddServiceProviderModelSchema, AddServiceProviderSchema, AllAvailableModelsSchema, IpcResponse, ServiceProviderModelsSchema, ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { createModelsDevImporter } from '@ant-chat/agent-runtime'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { getMainWindow } from '@main/windows/window'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

function notifyProviderChanged() {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('provider:changed')
  }
}

export class ProviderIpcService extends IpcService {
  static readonly groupName = 'provider'

  @IpcMethod()
  async getAllProviderServices(): Promise<IpcResponse<ServiceProviderSchema[]>> {
    try {
      const data = getAppDataServices().providerSettingsRepository.getAllProviderServices()
      return createIpcResponse(true, data)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async updateProviderService(serviceData: UpdateServiceProviderSchema): Promise<IpcResponse<ServiceProviderSchema>> {
    try {
      const updatedData = getAppDataServices().providerSettingsRepository.updateProviderService(serviceData)
      notifyProviderChanged()
      return createIpcResponse(true, updatedData)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addProviderServices(data: AddServiceProviderSchema): Promise<IpcResponse<ServiceProviderSchema>> {
    try {
      const result = getAppDataServices().providerSettingsRepository.addProviderService(data)
      notifyProviderChanged()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteProviderService(id: string): Promise<IpcResponse<null>> {
    try {
      getAppDataServices().providerSettingsRepository.deleteProviderService(id)
      notifyProviderChanged()
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getProviderServicesById(id: string): Promise<IpcResponse<ServiceProviderSchema>> {
    try {
      const result = getAppDataServices().providerSettingsRepository.getProviderServiceById(id)
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
      const result = getAppDataServices().providerSettingsRepository.getServiceProviderByModelId(id)
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
      const result = getAppDataServices().providerSettingsRepository.getAllAvailableModels()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelsByServiceProviderId(id: string): Promise<IpcResponse<ServiceProviderModelsSchema[]>> {
    try {
      const result = getAppDataServices().providerSettingsRepository.getModelsByServiceProviderId(id)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelById(id: string): Promise<IpcResponse<ServiceProviderModelsSchema>> {
    try {
      const result = getAppDataServices().providerSettingsRepository.getModelById(id)
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
      const result = getAppDataServices().providerSettingsRepository.setModelEnabledStatus(id, status)
      notifyProviderChanged()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addProviderServiceModel(config: AddServiceProviderModelSchema): Promise<IpcResponse<ServiceProviderModelsSchema>> {
    try {
      const result = getAppDataServices().providerSettingsRepository.addServiceProviderModel(config)
      notifyProviderChanged()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteProviderServiceModel(id: string): Promise<IpcResponse<null>> {
    try {
      getAppDataServices().providerSettingsRepository.deleteServiceProviderModel(id)
      notifyProviderChanged()
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelsDevProviders(): Promise<IpcResponse<ModelsDevProvider[]>> {
    try {
      const modelsDevImporter = createModelsDevImporter(getAppDataServices())
      const result = await modelsDevImporter.getModelsDevProviders()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelsDevModelsByProviderId(providerId: string): Promise<IpcResponse<ModelsDevModel[]>> {
    try {
      const modelsDevImporter = createModelsDevImporter(getAppDataServices())
      const result = await modelsDevImporter.getModelsDevModelsByProviderId(providerId)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async importModelsDevModels(providerId: string): Promise<IpcResponse<{ added: string[], skipped: string[], duplicates: string[], errors: { model: string, reason: string }[] }>> {
    try {
      const modelsDevImporter = createModelsDevImporter(getAppDataServices())
      const result = await modelsDevImporter.importModelsDevModels(providerId)
      notifyProviderChanged()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }
}
