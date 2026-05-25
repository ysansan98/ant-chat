import type { AddServiceProviderModelSchema, AddServiceProviderSchema, AllAvailableModelsSchema, IpcResponse, ModelsDevModel, ProviderSettingsSchema, ServiceProviderModelsSchema, ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { logger } from '@main/utils/logger'
import { getMainWindow } from '@main/window'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import { getModelsDevModelsByProviderId, getModelsDevProviders } from './modelsDev'

function notifyProviderChanged() {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('provider:changed')
  }
}

function toModelFeatures(model: ModelsDevModel) {
  const hasFeatures = model.toolCall || model.reasoning || model.vision
  return hasFeatures
    ? {
        functionCall: model.toolCall || undefined,
        reasoning: model.reasoning || undefined,
        vision: model.vision || undefined,
      }
    : undefined
}

async function getModelsDevModelMap(providerId: string): Promise<Map<string, ModelsDevModel>> {
  try {
    const models = await getModelsDevModelsByProviderId(providerId)
    return new Map(models.map(model => [model.model, model]))
  }
  catch (error) {
    logger.warn('Failed to load models.dev metadata:', error)
    return new Map()
  }
}

async function resolveProviderModels(provider: ProviderSettingsSchema): Promise<ServiceProviderModelsSchema[]> {
  const modelsDevMap = await getModelsDevModelMap(provider.id)
  return Object.entries(provider.models).map(([modelId, config]) => {
    const metadata = modelsDevMap.get(modelId)
    const overrides = config.overrides ?? {}
    return {
      id: modelId,
      model: modelId,
      name: overrides.name ?? metadata?.name ?? modelId,
      isBuiltin: false,
      isEnabled: config.isEnabled,
      maxTokens: overrides.maxTokens ?? metadata?.maxTokens ?? 4096,
      contextLength: overrides.contextLength ?? metadata?.contextLength ?? 4096,
      temperature: config.temperature ?? 0.7,
      modelFeatures: overrides.modelFeatures ?? (metadata ? toModelFeatures(metadata) : undefined),
      serviceProviderId: provider.id,
      createdAt: 0,
    }
  })
}

async function resolveModel(providerId: string, modelId: string): Promise<ServiceProviderModelsSchema | null> {
  const provider = getAppDataServices().providerSettingsRepository.getProviderSettingsById(providerId)
  if (!provider || !provider.models[modelId]) {
    return null
  }
  const models = await resolveProviderModels(provider)
  return models.find(model => model.id === modelId) ?? null
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
      const providers = getAppDataServices().providerSettingsRepository.getAllProviderServices().filter(provider => provider.isEnabled)
      const result = await Promise.all(providers.map(async (provider) => {
        const providerSettings = getAppDataServices().providerSettingsRepository.getProviderSettingsById(provider.id)
        return {
          ...provider,
          models: providerSettings
            ? (await resolveProviderModels(providerSettings)).filter(model => model.isEnabled)
            : [],
        }
      }))
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelsByServiceProviderId(id: string): Promise<IpcResponse<ServiceProviderModelsSchema[]>> {
    try {
      const provider = getAppDataServices().providerSettingsRepository.getProviderSettingsById(id)
      const result = provider ? await resolveProviderModels(provider) : []
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getModelById(id: string): Promise<IpcResponse<ServiceProviderModelsSchema>> {
    try {
      const provider = getAppDataServices().providerSettingsRepository.getServiceProviderByModelId(id)
      const result = provider ? await resolveModel(provider.id, id) : null
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
          getAppDataServices().providerSettingsRepository.addProviderModelReference(providerId, model.model, { temperature: 0.7 })
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
