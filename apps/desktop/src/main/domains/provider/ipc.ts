import type { AddServiceProviderModelSchema, AddServiceProviderSchema, AllAvailableModelsSchema, IpcResponse, ServiceProviderModelsSchema, ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { services } from '@main/db'
import { getMainWindow } from '@main/window'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import { getModelsDevModelsByProviderId, getModelsDevProviders } from './modelsDev'

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
      const result = services.addProviderService(data)
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
      await services.deleteProviderService(id)
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
      const result = await services.addServiceProviderModel(config)
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
      await services.deleteServiceProviderModel(id)
      notifyProviderChanged()
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelsDevProviders(): Promise<IpcResponse<Awaited<ReturnType<typeof getModelsDevProviders>>>> {
    try {
      const result = await getModelsDevProviders()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelsDevModelsByProviderId(providerId: string): Promise<IpcResponse<Awaited<ReturnType<typeof getModelsDevModelsByProviderId>>>> {
    try {
      const result = await getModelsDevModelsByProviderId(providerId)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async importModelsDevModels(providerId: string): Promise<IpcResponse<{ added: string[], skipped: string[], duplicates: string[], errors: { model: string, reason: string }[] }>> {
    try {
      const models = await getModelsDevModelsByProviderId(providerId)
      const existingModels = await services.getModelsByServiceProviderId(providerId)
      const existingModelSet = new Set(existingModels.map(item => item.model))
      const added: string[] = []
      const skipped: string[] = []
      const duplicates: string[] = []
      const errors: { model: string, reason: string }[] = []
      const seen = new Set(existingModelSet)

      for (const model of models) {
        const displayName = model.name ? `${model.name} (${model.model})` : model.model
        if (seen.has(model.model)) {
          if (existingModelSet.has(model.model)) {
            skipped.push(displayName)
          }
          else {
            duplicates.push(displayName)
          }
          continue
        }

        try {
          const hasFeatures = model.toolCall || model.reasoning || model.vision
          const modelFeatures = hasFeatures
            ? {
                functionCall: model.toolCall || undefined,
                reasoning: model.reasoning || undefined,
                vision: model.vision || undefined,
              }
            : undefined
          await services.addServiceProviderModel({
            serviceProviderId: providerId,
            model: model.model,
            name: model.name,
            maxTokens: model.maxTokens || 4096,
            contextLength: model.contextLength || 4096,
            temperature: 0.7,
            modelFeatures,
          })
          seen.add(model.model)
          added.push(displayName)
        }
        catch (error) {
          errors.push({ model: displayName, reason: (error as Error).message })
        }
      }

      notifyProviderChanged()
      return createIpcResponse(true, { added, skipped, duplicates, errors })
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }
}
