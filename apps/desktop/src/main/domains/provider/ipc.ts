import type { AllAvailableModelsSchema, CreateProviderConfigModelSchema, CreateProviderConfigSchema, IpcResponse, ModelsDevModel, ModelsDevProvider, ProviderConfigModelSchema, ProviderConfigSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class ProviderIpcService extends IpcService {
  static readonly groupName = 'provider'

  @IpcMethod()
  async listProviders(): Promise<IpcResponse<ProviderConfigSchema[]>> {
    return withIpcResponse(() => getAppRuntime().provider.list(), '获取 Provider 列表失败')
  }

  @IpcMethod()
  async updateProvider(providerConfig: UpdateProviderConfigSchema): Promise<IpcResponse<ProviderConfigSchema>> {
    return withIpcResponse(() => getAppRuntime().provider.update(providerConfig), '更新 Provider 失败')
  }

  @IpcMethod()
  async createProvider(data: CreateProviderConfigSchema): Promise<IpcResponse<ProviderConfigSchema>> {
    return withIpcResponse(() => getAppRuntime().provider.create(data), '创建 Provider 失败')
  }

  @IpcMethod()
  async deleteProvider(id: string): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().provider.delete(id), '删除 Provider 失败')
  }

  @IpcMethod()
  async getProviderById(id: string): Promise<IpcResponse<ProviderConfigSchema>> {
    return withIpcResponse(() => getAppRuntime().provider.getById(id), '获取 Provider 详情失败')
  }

  @IpcMethod()
  async getProviderByModelId(id: string): Promise<IpcResponse<ProviderConfigSchema>> {
    return withIpcResponse(() => getAppRuntime().provider.getByModelId(id), '根据模型获取 Provider 失败')
  }

  @IpcMethod()
  async getAllAbvailableModels(): Promise<IpcResponse<AllAvailableModelsSchema[]>> {
    return withIpcResponse(() => getAppRuntime().provider.listAvailableModels(), '获取所有可用模型失败')
  }

  @IpcMethod()
  async listProviderModels(id: string): Promise<IpcResponse<ProviderConfigModelSchema[]>> {
    return withIpcResponse(() => getAppRuntime().provider.listModels(id), '获取 Provider 模型列表失败')
  }

  @IpcMethod()
  async getModelById(id: string): Promise<IpcResponse<ProviderConfigModelSchema>> {
    return withIpcResponse(() => getAppRuntime().provider.getModel(id), '获取模型详情失败')
  }

  @IpcMethod()
  async setModelEnabledStatus(id: string, status: boolean): Promise<IpcResponse<ProviderConfigModelSchema>> {
    return withIpcResponse(() => getAppRuntime().provider.setModelEnabled(id, status), '更新模型启用状态失败')
  }

  @IpcMethod()
  async createProviderModel(config: CreateProviderConfigModelSchema): Promise<IpcResponse<ProviderConfigModelSchema>> {
    return withIpcResponse(() => getAppRuntime().provider.createModel(config), '创建模型失败')
  }

  @IpcMethod()
  async deleteProviderModel(id: string): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().provider.deleteModel(id), '删除模型失败')
  }

  @IpcMethod()
  async getModelsDevProviders(): Promise<IpcResponse<ModelsDevProvider[]>> {
    return withIpcResponse(() => getAppRuntime().provider.getModelsDevProviders(), '获取 models.dev Provider 列表失败')
  }

  @IpcMethod()
  async getModelsDevModelsByProviderId(providerId: string): Promise<IpcResponse<ModelsDevModel[]>> {
    return withIpcResponse(() => getAppRuntime().provider.getModelsDevModels(providerId), '获取 models.dev 模型列表失败')
  }

  @IpcMethod()
  async importModelsDevModels(providerId: string): Promise<IpcResponse<{ added: string[], skipped: string[], duplicates: string[], errors: { model: string, reason: string }[] }>> {
    return withIpcResponse(() => getAppRuntime().provider.importModelsDevModels(providerId), '导入 models.dev 模型失败')
  }
}
