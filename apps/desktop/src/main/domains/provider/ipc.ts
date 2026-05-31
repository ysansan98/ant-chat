import type { ModelsDevModel, ModelsDevProvider } from '@ant-chat/agent-runtime'
import type { AllAvailableModelsSchema, CreateProviderConfigModelSchema, CreateProviderConfigSchema, IpcResponse, ProviderConfigModelSchema, ProviderConfigSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { createModelsDevImporter } from '@ant-chat/agent-runtime'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'
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
  async listProviders(): Promise<IpcResponse<ProviderConfigSchema[]>> {
    try {
      const data = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.listProviders()
      return createIpcResponse(true, data)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async updateProvider(providerConfig: UpdateProviderConfigSchema): Promise<IpcResponse<ProviderConfigSchema>> {
    try {
      const updatedData = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.updateProvider(providerConfig)
      notifyProviderChanged()
      return createIpcResponse(true, updatedData)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async createProvider(data: CreateProviderConfigSchema): Promise<IpcResponse<ProviderConfigSchema>> {
    try {
      const result = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.createProvider(data)
      notifyProviderChanged()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteProvider(id: string): Promise<IpcResponse<null>> {
    try {
      getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.deleteProvider(id)
      notifyProviderChanged()
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getProviderById(id: string): Promise<IpcResponse<ProviderConfigSchema>> {
    try {
      const result = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.getProviderById(id)
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
  async getProviderByModelId(id: string): Promise<IpcResponse<ProviderConfigSchema>> {
    try {
      const result = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.getProviderByModelId(id)
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
      const result = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.getAllAvailableModels()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async listProviderModels(id: string): Promise<IpcResponse<ProviderConfigModelSchema[]>> {
    try {
      const result = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.listProviderModels(id)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelById(id: string): Promise<IpcResponse<ProviderConfigModelSchema>> {
    try {
      const result = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.getModelById(id)
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
  async setModelEnabledStatus(id: string, status: boolean): Promise<IpcResponse<ProviderConfigModelSchema>> {
    try {
      const result = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.setModelEnabledStatus(id, status)
      notifyProviderChanged()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async createProviderModel(config: CreateProviderConfigModelSchema): Promise<IpcResponse<ProviderConfigModelSchema>> {
    try {
      const result = getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.createProviderModel(config)
      notifyProviderChanged()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteProviderModel(id: string): Promise<IpcResponse<null>> {
    try {
      getAgentRuntimeEnvironment().appDataContext.providerSettingsRepository.deleteProviderModel(id)
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
      const modelsDevImporter = createModelsDevImporter(getAgentRuntimeEnvironment().appDataContext)
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
      const modelsDevImporter = createModelsDevImporter(getAgentRuntimeEnvironment().appDataContext)
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
      const modelsDevImporter = createModelsDevImporter(getAgentRuntimeEnvironment().appDataContext)
      const result = await modelsDevImporter.importModelsDevModels(providerId)
      notifyProviderChanged()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }
}
