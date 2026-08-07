import type { AIProviderFactory, AppRpcInput, CreateProviderConfigSchema, ProviderAuthStatus, ProviderConfigSchema, ProviderIntegrationId, ProviderPublicView, ProviderUsageStatus, UpdateProviderConfigSchema } from '@ant-chat/shared'
import type { ProviderSettingsRepository } from '../../../data'
import type { RuntimeEventBus } from '../../../events'
import type { KeychainSecretStore } from '../../../secretStore'
import type { SystemLogger } from '../../../systemLogger'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import type { OAuthCallbackHost } from '../../types'
import type { ProviderAuthAdapter, ProviderIntegration, ProviderIntegrationRegistry } from './providerIntegration'
import { randomUUID } from 'node:crypto'
import { CreateProviderConfigSchema as CreateProviderConfigValidator, UpdateProviderConfigSchema as UpdateProviderConfigValidator } from '@ant-chat/shared'
import { createProvider } from '../../../agent-core'
import { createModelsDevImporter } from '../../../agent-runtime'
import { getProviderApiKeyId } from '../../../secretStore'
import { Method, Module } from '../../decorators'
import { registerOAuthCallbackHandler } from '../../types'
import { createDefaultProviderIntegration, createModelsDevModelSource } from './providerIntegration'

@Module('provider')
export class ProviderModule implements RuntimeModuleMethods<'provider'> {
  readonly aiProviderFactory: AIProviderFactory
  private readonly modelsDevImporter: ReturnType<typeof createModelsDevImporter>
  private readonly providerIntegrations: ProviderIntegrationRegistry

  private readonly removeOAuthCallbackHandler: () => void
  private readonly oauthCallbackHost?: OAuthCallbackHost

  constructor(
    private readonly providerSettingsRepository: ProviderSettingsRepository,
    private readonly secretStore: KeychainSecretStore,
    private readonly events: RuntimeEventBus,
    logger: SystemLogger,
    oauthCallbackHost?: OAuthCallbackHost,
    /** 厂商 Integration 在 composition root 注册；新增订阅只追加这里，不改通用流程。 */
    integrations: Array<[ProviderIntegrationId, ProviderIntegration]> = [],
  ) {
    this.oauthCallbackHost = oauthCallbackHost
    this.modelsDevImporter = createModelsDevImporter()
    const registry = new Map<ProviderIntegrationId, ProviderIntegration>()
    // API Key 是显式 registry entry，不依赖默认回退。
    registry.set('api-key', createDefaultProviderIntegration(
      createModelsDevModelSource(providerId => this.modelsDevImporter.getModelsDevModelsByProviderId(providerId)),
      secretStore,
    ))
    for (const [id, integration] of integrations) {
      if (registry.has(id)) {
        throw new Error(`Integration 重复注册或覆盖内建项：${id}`)
      }
      assertIntegrationConsistent(id, integration)
      registry.set(id, integration)
    }
    for (const provider of providerSettingsRepository.listProviders()) {
      if (!registry.has(provider.integrationId)) {
        throw new Error(`Provider ${provider.id} 引用了未注册的 Integration：${provider.integrationId}`)
      }
    }
    this.providerIntegrations = registry
    this.removeOAuthCallbackHandler = registerOAuthCallbackHandler(
      oauthCallbackHost,
      params => this.handleOAuthCallback(params),
    )
    this.aiProviderFactory = async ({ provider }) => {
      const integration = this.getIntegration(provider)
      if (integration.createAIProvider) {
        return await integration.createAIProvider(provider)
      }
      const apiKey = await resolveProviderApiKey(secretStore, provider)
      return await createProvider({ ...provider, apiKey }, { logger })
    }
  }

  dispose() {
    this.removeOAuthCallbackHandler()
    for (const integration of this.providerIntegrations.values()) {
      integration.dispose?.()
    }
  }

  @Method()
  listProviders(_input?: AppRpcInput<'provider.listProviders'>) {
    return this.providerSettingsRepository.listProviders().map(provider => this.toPublicProvider(provider))
  }

  @Method()
  listIntegrations(_input?: AppRpcInput<'provider.listIntegrations'>) {
    return [...this.providerIntegrations.entries()].map(([id, integration]) => ({
      id,
      label: integration.descriptor.label,
      authentication: integration.capabilities.authentication,
      defaultApiMode: integration.descriptor.defaultApiMode,
      fixedApiMode: integration.descriptor.fixedApiMode,
      fixedBaseUrl: integration.capabilities.fixedBaseUrl,
    }))
  }

  @Method()
  async createProvider(input: AppRpcInput<'provider.createProvider'>) {
    const publicConfig = CreateProviderConfigValidator.parse(input.config)
    const id = publicConfig.id ?? `provider-${randomUUID()}`
    if (this.providerSettingsRepository.getProviderById(id)) {
      throw new Error(`Provider already exists: ${id}`)
    }
    const candidate: ProviderConfigSchema = {
      ...publicConfig,
      id,
      isOfficial: false,
      isEnabled: publicConfig.isEnabled ?? false,
      createdAt: 0,
      updatedAt: 0,
    }
    this.getIntegration(candidate).validateConfig(candidate)
    const secretCreate = await prepareCreateProviderConfig(this.secretStore, { ...publicConfig, id })
    let provider: ProviderConfigSchema
    try {
      provider = this.providerSettingsRepository.createProvider(secretCreate.config)
    }
    catch (error) {
      return await rollbackProviderTransition(error, [secretCreate])
    }
    this.events.emit('provider:changed', { providerId: provider.id })
    return this.toPublicProvider(provider)
  }

  @Method()
  async updateProvider(input: AppRpcInput<'provider.updateProvider'>) {
    const existing = this.requireProvider(input.config.id)
    const publicPatch = UpdateProviderConfigValidator.parse(input.config)
    const candidate = {
      ...existing,
      ...publicPatch,
      integrationId: publicPatch.integrationId ?? existing.integrationId,
    }
    this.getIntegration(candidate).validateConfig(candidate)
    const integrationChanged = existing.integrationId !== candidate.integrationId
    const revocation = integrationChanged
      ? await this.getIntegration(existing).prepareRevoke(existing)
      : undefined
    const secretUpdate = await prepareProviderSecret(this.secretStore, publicPatch)
    // apiKeySecretId 只属于 API Key Integration。切换到订阅 Integration 时必须
    // 显式清除持久化引用，否则 Keychain 已撤销但 settings 仍会误报 hasApiKey。
    const config = integrationChanged && candidate.integrationId !== 'api-key'
      ? { ...secretUpdate.config, apiKeySecretId: undefined }
      : secretUpdate.config
    try {
      await revocation?.commit()
      const provider = this.providerSettingsRepository.updateProvider(config)
      this.events.emit('provider:changed', { providerId: provider.id })
      return this.toPublicProvider(provider)
    }
    catch (error) {
      return await rollbackProviderTransition(error, [revocation, secretUpdate])
    }
  }

  @Method()
  async deleteProvider(input: AppRpcInput<'provider.deleteProvider'>) {
    const provider = this.requireProvider(input.id)
    const integration = this.getIntegration(provider)
    const revocation = await integration.prepareRevoke(provider)
    // 先清理凭据，再删除配置：凭据清理失败时 Provider 仍保留在列表中可重试，
    // 避免"配置已删但 Keychain 孤儿凭据无法再通过 UI 清理"。
    try {
      await revocation.commit()
      this.providerSettingsRepository.deleteProvider(input.id)
    }
    catch (error) {
      await rollbackProviderTransition(error, [revocation])
    }
    integration.discard?.(input.id)
    this.events.emit('provider:changed', { providerId: input.id })
    return null
  }

  @Method()
  getProviderById(input: AppRpcInput<'provider.getProviderById'>) {
    return this.toPublicProvider(requireValue(
      this.providerSettingsRepository.getProviderById(input.id),
      `Provider not found: ${input.id}`,
    ))
  }

  @Method()
  getAllAbvailableModels(_input: AppRpcInput<'provider.getAllAbvailableModels'>) {
    return this.providerSettingsRepository.getAllAvailableModels()
  }

  @Method()
  listProviderModels(input: AppRpcInput<'provider.listProviderModels'>) {
    return this.providerSettingsRepository.listProviderModels(input.id)
  }

  @Method()
  setModelEnabledStatus(input: AppRpcInput<'provider.setModelEnabledStatus'>) {
    const model = this.providerSettingsRepository.setModelEnabledStatus(input.providerId, input.modelId, input.status)
    this.events.emit('provider:changed', { providerId: model.providerId })
    return model
  }

  @Method()
  createProviderModel(input: AppRpcInput<'provider.createProviderModel'>) {
    const model = this.providerSettingsRepository.createProviderModel(input.config)
    this.events.emit('provider:changed', { providerId: model.providerId })
    return model
  }

  @Method()
  deleteProviderModel(input: AppRpcInput<'provider.deleteProviderModel'>) {
    this.providerSettingsRepository.deleteProviderModel(input.providerId, input.modelId)
    this.events.emit('provider:changed', { providerId: input.providerId })
    return null
  }

  @Method()
  getModel(input: AppRpcInput<'provider.getModel'>) {
    return requireValue(
      this.providerSettingsRepository.getModel(input.providerId, input.modelId),
      `Provider model not found: ${input.providerId}/${input.modelId}`,
    )
  }

  @Method()
  getModelsDevProviders(_input: AppRpcInput<'provider.getModelsDevProviders'>) {
    return this.modelsDevImporter.getModelsDevProviders()
  }

  @Method()
  async syncModels(input: AppRpcInput<'provider.syncModels'>) {
    const provider = this.requireProvider(input.providerId)
    const models = await this.getIntegration(provider).modelSource.listModels(provider)
    const syncedModels = this.providerSettingsRepository.syncProviderModels(provider.id, models)
    this.events.emit('provider:changed', { providerId: provider.id })
    return syncedModels
  }

  @Method()
  async startOAuthLogin(input: AppRpcInput<'provider.startOAuthLogin'>) {
    const provider = this.requireProvider(input.providerId)
    const auth = this.requireAuthAdapter(provider)
    if (!this.oauthCallbackHost) {
      throw new Error('当前运行环境没有可用的 OAuth 回调宿主。')
    }
    const redirectUrl = this.oauthCallbackHost.resolveOAuthRedirectUrl
      ? await this.oauthCallbackHost.resolveOAuthRedirectUrl(provider.integrationId)
      : this.oauthCallbackHost.redirectUrl
    const result = auth.startLogin(provider, redirectUrl)
    await this.oauthCallbackHost.openAuthorization(result.authorizationUrl)
    return result
  }

  @Method()
  async importLocalAuth(input: AppRpcInput<'provider.importLocalAuth'>): Promise<ProviderAuthStatus> {
    const provider = this.requireProvider(input.providerId)
    // 必须持有 adapter 实例再调用方法：解构后裸调用会丢失 this，
    // 使类方法内部访问 this.options 抛 TypeError。
    const auth = this.requireAuthAdapter(provider)
    if (!auth.importLocalAuth) {
      throw new Error(`Provider 不支持本地凭据导入：${provider.id}`)
    }
    const status = await auth.importLocalAuth(provider)
    this.events.emit('provider:changed', { providerId: provider.id })
    return status
  }

  @Method()
  async getAuthStatus(input: AppRpcInput<'provider.getAuthStatus'>): Promise<ProviderAuthStatus> {
    const provider = this.requireProvider(input.providerId)
    return await this.requireAuthAdapter(provider).getStatus(provider)
  }

  @Method()
  async getUsage(input: AppRpcInput<'provider.getUsage'>): Promise<ProviderUsageStatus> {
    const provider = this.requireProvider(input.providerId)
    const getUsage = this.getIntegration(provider).getUsage
    if (!getUsage) {
      throw new Error(`Provider 不支持额度查询：${provider.id}`)
    }
    return await getUsage(provider)
  }

  @Method()
  async logoutAuth(input: AppRpcInput<'provider.logoutAuth'>) {
    const provider = this.requireProvider(input.providerId)
    await this.requireAuthAdapter(provider).logout(provider)
    this.events.emit('provider:changed', { providerId: provider.id })
    return null
  }

  private async handleOAuthCallback(params: URLSearchParams): Promise<boolean> {
    for (const integration of this.providerIntegrations.values()) {
      const handled = integration.auth ? await integration.auth.handleCallback(params) : false
      if (handled) {
        this.events.emit('provider:changed', {})
        return true
      }
    }
    return false
  }

  private getIntegration(provider: ProviderConfigSchema): ProviderIntegration {
    // unknown Integration 必须 fail closed，不能静默回退到默认实现。
    const integration = this.providerIntegrations.get(provider.integrationId)
    if (!integration) {
      throw new Error(`未知的 Integration：${provider.integrationId}`)
    }
    return integration
  }

  private requireAuthAdapter(provider: ProviderConfigSchema): ProviderAuthAdapter {
    const auth = this.getIntegration(provider).auth
    if (!auth) {
      throw new Error(`Provider 不支持订阅认证：${provider.id}`)
    }
    return auth
  }

  private toPublicProvider(provider: ProviderConfigSchema): ProviderPublicView {
    const { apiKey: _apiKey, apiKeySecretId: _apiKeySecretId, ...publicProvider } = provider
    return {
      ...publicProvider,
      capabilities: this.getIntegration(provider).capabilities,
    }
  }

  private requireProvider(providerId: string): ProviderConfigSchema {
    const provider = this.providerSettingsRepository.getProviderById(providerId)
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`)
    }
    return provider
  }
}

export async function resolveProviderApiKey(
  secretStore: KeychainSecretStore,
  provider: { id: string, apiKeySecretId?: string },
) {
  if (provider.apiKeySecretId) {
    if (provider.apiKeySecretId !== getProviderApiKeyId(provider.id)) {
      throw new Error(`Provider ${provider.id} 的 API Key secret ref audience 不匹配。`)
    }
  }
  // Provider 只能通过 owner-bound API 读取自己的 credential，不能把持久化
  // secret ref 当作通用 bearer capability 交给任意调用方解析。
  const value = await secretStore.getProviderApiKey(provider.id)
  if (value) {
    return value
  }
  throw new Error(`Provider API Key not found: ${provider.id}`)
}

async function prepareProviderSecret(
  secretStore: KeychainSecretStore,
  config: UpdateProviderConfigSchema,
): Promise<{ config: Omit<UpdateProviderConfigSchema, 'apiKey'> & { apiKeySecretId?: string }, rollback: () => Promise<void> }> {
  if (config.apiKey === undefined) {
    return { config, rollback: async () => {} }
  }
  const previous = await secretStore.getProviderApiKey(config.id)
  const rollback = async () => {
    if (previous === null) {
      await secretStore.deleteProviderApiKey(config.id)
    }
    else {
      await secretStore.saveProviderApiKey({ providerId: config.id, apiKey: previous })
    }
  }
  if (config.apiKey === '') {
    await secretStore.deleteProviderApiKey(config.id)
    const { apiKey: _apiKey, ...safeConfig } = config
    return { config: { ...safeConfig, apiKeySecretId: undefined }, rollback }
  }
  const ref = await secretStore.saveProviderApiKey({ providerId: config.id, apiKey: config.apiKey })
  const { apiKey: _apiKey, ...safeConfig } = config
  return { config: { ...safeConfig, apiKeySecretId: ref.id }, rollback }
}

async function prepareCreateProviderConfig(
  secretStore: KeychainSecretStore,
  config: CreateProviderConfigSchema,
): Promise<{ config: Omit<CreateProviderConfigSchema, 'apiKey'> & { id: string, apiKeySecretId?: string }, rollback: () => Promise<void> }> {
  const id = config.id ?? `provider-${randomUUID()}`
  if (!config.apiKey) {
    const { apiKey: _apiKey, ...safeConfig } = config
    return { config: { ...safeConfig, id }, rollback: async () => {} }
  }
  const previous = await secretStore.getProviderApiKey(id)
  const ref = await secretStore.saveProviderApiKey({ providerId: id, apiKey: config.apiKey })
  const { apiKey: _apiKey, ...safeConfig } = config
  return {
    config: { ...safeConfig, id, apiKeySecretId: ref.id },
    rollback: async () => {
      if (previous === null) {
        await secretStore.deleteProviderApiKey(id)
      }
      else {
        await secretStore.saveProviderApiKey({ providerId: id, apiKey: previous })
      }
    },
  }
}

function requireValue<T>(value: T, message: string): NonNullable<T> {
  if (value === undefined || value === null)
    throw new Error(message)
  return value as NonNullable<T>
}

/** 注册期 fail-fast：capability 声明与实际可用方法不得自相矛盾。 */
function assertIntegrationConsistent(id: string, integration: ProviderIntegration): void {
  if (integration.capabilities.authentication === 'oauth' && !integration.auth) {
    throw new Error(`Integration ${id} 声明 OAuth 认证但没有 auth adapter。`)
  }
  if (integration.capabilities.usage === 'quota' && !integration.getUsage) {
    throw new Error(`Integration ${id} 声明额度能力但没有 getUsage 方法。`)
  }
}

async function rollbackProviderTransition(
  originalError: unknown,
  transitions: Array<{ rollback: () => Promise<void> } | undefined>,
): Promise<never> {
  const rollbackErrors: unknown[] = []
  for (const transition of transitions.reverse()) {
    if (!transition) {
      continue
    }
    try {
      await transition.rollback()
    }
    catch (error) {
      rollbackErrors.push(error)
    }
  }
  if (rollbackErrors.length) {
    throw new AggregateError([originalError, ...rollbackErrors], 'Provider 状态提交失败，且凭据回滚未完全成功。')
  }
  throw originalError
}
