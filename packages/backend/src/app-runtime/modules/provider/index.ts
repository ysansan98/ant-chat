import type { AIProviderFactory, AppRpcInput, CreateProviderConfigSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import type { KeychainSecretStore } from '../../../secretStore'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { randomUUID } from 'node:crypto'
import { createProvider } from '../../../agent-core'
import { createModelsDevImporter } from '../../../agent-runtime'
import { Method, Module } from '../../decorators'

@Module('provider')
export class ProviderModule implements RuntimeModuleMethods<'provider'> {
  readonly aiProviderFactory: AIProviderFactory
  private readonly modelsDevImporter: ReturnType<typeof createModelsDevImporter>

  constructor(private readonly core: Pick<RuntimeCore, 'data' | 'events' | 'logger' | 'secretStore'>) {
    this.modelsDevImporter = createModelsDevImporter(core.data)
    this.aiProviderFactory = async ({ provider }) => {
      const apiKey = await resolveProviderApiKey(core.secretStore, provider)
      return await createProvider({ ...provider, apiKey }, { logger: core.logger })
    }
  }

  async initialize() {
    const migratedSecrets = await this.core.data.providerSettingsRepository.migratePlaintextApiKeys(this.core.secretStore)
    if (migratedSecrets) {
      this.core.events.emit('provider:changed', {})
    }
  }

  @Method()
  listProviders(_input: AppRpcInput<'provider.listProviders'>) {
    return this.core.data.providerSettingsRepository.listProviders()
  }

  @Method()
  async createProvider(input: AppRpcInput<'provider.createProvider'>) {
    const config = await prepareCreateProviderConfig(this.core.secretStore, input.config)
    const provider = this.core.data.providerSettingsRepository.createProvider(config)
    this.core.events.emit('provider:changed', { providerId: provider.id })
    return provider
  }

  @Method()
  async updateProvider(input: AppRpcInput<'provider.updateProvider'>) {
    const config = await prepareProviderSecret(this.core.secretStore, input.config)
    const provider = this.core.data.providerSettingsRepository.updateProvider(config)
    this.core.events.emit('provider:changed', { providerId: provider.id })
    return provider
  }

  @Method()
  async deleteProvider(input: AppRpcInput<'provider.deleteProvider'>) {
    this.core.data.providerSettingsRepository.deleteProvider(input.id)
    await this.core.secretStore.deleteProviderApiKey(input.id)
    this.core.events.emit('provider:changed', { providerId: input.id })
    return null
  }

  @Method()
  getProviderById(input: AppRpcInput<'provider.getProviderById'>) {
    return requireValue(
      this.core.data.providerSettingsRepository.getProviderById(input.id),
      `Provider not found: ${input.id}`,
    )
  }

  @Method()
  async getProviderApiKey(input: AppRpcInput<'provider.getProviderApiKey'>) {
    const provider = this.core.data.providerSettingsRepository.getProviderSettingsById(input.id)
    if (!provider)
      return null
    try {
      return await resolveProviderApiKey(this.core.secretStore, provider)
    }
    catch {
      return null
    }
  }

  @Method()
  getAllAbvailableModels(_input: AppRpcInput<'provider.getAllAbvailableModels'>) {
    return this.core.data.providerSettingsRepository.getAllAvailableModels()
  }

  @Method()
  listProviderModels(input: AppRpcInput<'provider.listProviderModels'>) {
    return this.core.data.providerSettingsRepository.listProviderModels(input.id)
  }

  @Method()
  setModelEnabledStatus(input: AppRpcInput<'provider.setModelEnabledStatus'>) {
    const model = this.core.data.providerSettingsRepository.setModelEnabledStatus(input.id, input.status)
    this.core.events.emit('provider:changed', { providerId: model.providerId })
    return model
  }

  @Method()
  createProviderModel(input: AppRpcInput<'provider.createProviderModel'>) {
    const model = this.core.data.providerSettingsRepository.createProviderModel(input.config)
    this.core.events.emit('provider:changed', { providerId: model.providerId })
    return model
  }

  @Method()
  deleteProviderModel(input: AppRpcInput<'provider.deleteProviderModel'>) {
    this.core.data.providerSettingsRepository.deleteProviderModel(input.id)
    this.core.events.emit('provider:changed', {})
    return null
  }

  @Method()
  getModel(input: AppRpcInput<'provider.getModel'>) {
    return requireValue(
      this.core.data.providerSettingsRepository.getModel(input.providerId, input.modelId),
      `Provider model not found: ${input.providerId}/${input.modelId}`,
    )
  }

  @Method()
  getModelsDevProviders(_input: AppRpcInput<'provider.getModelsDevProviders'>) {
    return this.modelsDevImporter.getModelsDevProviders()
  }

  @Method()
  getModelsDevModelsByProviderId(input: AppRpcInput<'provider.getModelsDevModelsByProviderId'>) {
    return this.modelsDevImporter.getModelsDevModelsByProviderId(input.providerId)
  }

  @Method()
  async importModelsDevModels(input: AppRpcInput<'provider.importModelsDevModels'>) {
    const result = await this.modelsDevImporter.importModelsDevModels(input.providerId)
    this.core.events.emit('provider:changed', { providerId: input.providerId })
    return result
  }
}

export async function resolveProviderApiKey(
  secretStore: KeychainSecretStore,
  provider: { id: string, apiKey?: string, apiKeySecretId?: string },
) {
  if (provider.apiKey) {
    return provider.apiKey
  }
  if (provider.apiKeySecretId) {
    const value = await secretStore.resolve({ kind: 'secret_ref', id: provider.apiKeySecretId, scope: 'persistent' })
    if (value) {
      return value
    }
  }
  const value = await secretStore.getProviderApiKey(provider.id)
  if (value) {
    return value
  }
  throw new Error(`Provider API Key not found: ${provider.id}`)
}

async function prepareProviderSecret(
  secretStore: KeychainSecretStore,
  config: UpdateProviderConfigSchema,
): Promise<Omit<UpdateProviderConfigSchema, 'apiKey'> & { apiKeySecretId?: string }> {
  if (config.apiKey === undefined) {
    return config
  }
  if (config.apiKey === '') {
    await secretStore.deleteProviderApiKey(config.id)
    const { apiKey: _apiKey, ...safeConfig } = config
    return { ...safeConfig, apiKeySecretId: undefined }
  }
  const ref = await secretStore.saveProviderApiKey({ providerId: config.id, apiKey: config.apiKey })
  const { apiKey: _apiKey, ...safeConfig } = config
  return { ...safeConfig, apiKeySecretId: ref.id }
}

async function prepareCreateProviderConfig(
  secretStore: KeychainSecretStore,
  config: CreateProviderConfigSchema,
): Promise<Omit<CreateProviderConfigSchema, 'apiKey'> & { id: string, apiKeySecretId?: string }> {
  const id = config.id ?? `provider-${randomUUID()}`
  if (!config.apiKey) {
    const { apiKey: _apiKey, ...safeConfig } = config
    return { ...safeConfig, id }
  }
  const ref = await secretStore.saveProviderApiKey({ providerId: id, apiKey: config.apiKey })
  const { apiKey: _apiKey, ...safeConfig } = config
  return { ...safeConfig, id, apiKeySecretId: ref.id }
}

function requireValue<T>(value: T, message: string): NonNullable<T> {
  if (value === undefined || value === null)
    throw new Error(message)
  return value as NonNullable<T>
}
