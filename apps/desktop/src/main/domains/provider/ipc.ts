import type { AddServiceProviderModelSchema, AddServiceProviderSchema, AllAvailableModelsSchema, IpcResponse, ModelsDevModel, ServiceProviderModelsSchema, ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { getMainWindow } from '@main/windows/window'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import { getModelsDevModelsByProviderId, getModelsDevProviders } from './modelsDev'

function notifyProviderChanged() {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('provider:changed')
  }
}

const KNOWN_INPUT_MODALITIES = new Set(['text', 'image', 'pdf', 'video', 'audio'])

function toModelCapabilities(model: ModelsDevModel) {
  const hasFeatures = model.toolCall || model.reasoning || model.supportsTemperature || model.structuredOutput
    || (model.modalities?.input && model.modalities.input.length > 0)
  if (!hasFeatures)
    return undefined

  const inputModalities = model.modalities?.input?.length
    ? model.modalities.input.filter(m => KNOWN_INPUT_MODALITIES.has(m)) as ('text' | 'image' | 'pdf' | 'video' | 'audio')[]
    : undefined
  const outputModalities = model.modalities?.output?.length
    ? model.modalities.output.filter(m => m === 'text' || m === 'image') as ('text' | 'image')[]
    : undefined

  return {
    functionCall: model.toolCall || undefined,
    reasoning: model.reasoning || undefined,
    supportsTemperature: model.supportsTemperature || undefined,
    structuredOutput: model.structuredOutput || undefined,
    inputModalities,
    outputModalities,
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
      const provider = getAppDataServices().providerSettingsRepository.getProviderSettingsById(providerId)
      const existingModelSet = new Set(provider ? Object.keys(provider.models) : [])
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
          getAppDataServices().providerSettingsRepository.addServiceProviderModel({
            serviceProviderId: providerId,
            model: model.model,
            name: model.name,
            temperature: 0.7,
            maxTokens: model.maxTokens ?? 4096,
            contextLength: model.contextLength ?? 4096,
            capabilities: toModelCapabilities(model),
            cost: model.cost,
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
