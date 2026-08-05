import type { ProviderConfigSchema } from '@ant-chat/shared'
import type { CodexCredentialStore, CodexModelInfo } from '../../../agent-core/ai-providers/codex'
import type { KeychainSecretStore } from '../../../secretStore'
import type { ProviderIntegration, ProviderModelDefinition, ProviderModelSource } from './providerIntegration'
import { CODEX_DEFAULT_BASE_URL, CodexAIProvider, CodexAuthSession, CodexBackendClient, CodexOAuthCoordinator, parseCodexCredential, serializeCodexCredential } from '../../../agent-core/ai-providers/codex'
import { CodexAuthAdapter } from './codexAuthAdapter'

/**
 * Codex 订阅 Integration 拥有自己的认证会话、OAuth coordinator、HTTP client、
 * AI provider、模型源、额度和 teardown。通用 ProviderModule 只通过 registry
 * 以 ProviderIntegration 接口调用它，不直接触碰任何 Codex 类型。
 */
export function createCodexProviderIntegration(
  secretStore: Pick<KeychainSecretStore, 'getProviderIntegrationCredential' | 'saveProviderIntegrationCredential' | 'deleteProviderIntegrationCredential'>,
  options: { fetchImpl?: typeof fetch, now?: () => number } = {},
): ProviderIntegration {
  const authSessions = new Map<string, CodexAuthSession>()
  const oauthCoordinators = new Map<string, CodexOAuthCoordinator>()

  const credentialStore: CodexCredentialStore = {
    load: async providerId => parseCodexCredential(await secretStore.getProviderIntegrationCredential({ providerId, integrationId: 'codex-subscription' })),
    save: async (providerId, value) => {
      await secretStore.saveProviderIntegrationCredential({ providerId, integrationId: 'codex-subscription', value: serializeCodexCredential(value) })
    },
    clear: providerId => secretStore.deleteProviderIntegrationCredential({ providerId, integrationId: 'codex-subscription' }),
  }

  const getAuthSession = (providerId: string): CodexAuthSession => {
    const existing = authSessions.get(providerId)
    if (existing) {
      return existing
    }
    const session = new CodexAuthSession(providerId, credentialStore, options.fetchImpl ?? globalThis.fetch, options.now)
    authSessions.set(providerId, session)
    return session
  }

  const getOAuthCoordinator = (providerId: string): CodexOAuthCoordinator => {
    const existing = oauthCoordinators.get(providerId)
    if (existing) {
      return existing
    }
    const coordinator = new CodexOAuthCoordinator(getAuthSession(providerId), options.fetchImpl ?? globalThis.fetch, options.now)
    oauthCoordinators.set(providerId, coordinator)
    return coordinator
  }

  const createClient = (provider: ProviderConfigSchema): CodexBackendClient =>
    new CodexBackendClient({ authSession: getAuthSession(provider.id), fetchImpl: options.fetchImpl })

  const auth = new CodexAuthAdapter({
    getAuthSession: provider => getAuthSession(provider.id),
    getOAuthCoordinator: provider => getOAuthCoordinator(provider.id),
    getOAuthCoordinators: () => oauthCoordinators.values(),
  })

  const discard = (providerId: string): void => {
    authSessions.get(providerId)?.invalidate()
    authSessions.delete(providerId)
    oauthCoordinators.delete(providerId)
  }

  return {
    descriptor: { label: 'Codex 订阅', defaultApiMode: 'openai', fixedApiMode: 'openai' },
    capabilities: {
      authentication: 'oauth',
      modelSource: 'provider',
      localAuthImport: true,
      usage: 'quota',
      endpoint: 'fixed',
      fixedBaseUrl: CODEX_DEFAULT_BASE_URL,
    },
    modelSource: createCodexModelSource(createClient),
    validateConfig(provider) {
      if (provider.integrationId !== 'codex-subscription') {
        throw new Error(`Codex Integration 不接受 ${provider.integrationId} 配置。`)
      }
      if (provider.apiMode !== 'openai') {
        throw new Error('Codex 订阅仅支持 openai wire protocol。')
      }
      if (provider.baseUrl !== CODEX_DEFAULT_BASE_URL) {
        throw new Error('Codex 订阅使用固定 endpoint，不可自定义。')
      }
    },
    async prepareRevoke(provider) {
      const scope = { providerId: provider.id, integrationId: 'codex-subscription' as const }
      const previous = await secretStore.getProviderIntegrationCredential(scope)
      return {
        commit: async () => {
          await auth.logout(provider)
          discard(provider.id)
        },
        rollback: async () => {
          if (previous === null) {
            await secretStore.deleteProviderIntegrationCredential(scope)
          }
          else {
            await secretStore.saveProviderIntegrationCredential({ ...scope, value: previous })
          }
          discard(provider.id)
        },
      }
    },
    auth,
    createAIProvider: async provider => new CodexAIProvider(createClient(provider)),
    getUsage: async provider => createClient(provider).getUsage(),
    // 单个 Provider 卸载：失效其内存会话并移除，不删除持久化凭据。
    discard,
    // Integration 整体卸载：让在途 refresh/写回因 generation 不匹配被拒绝。
    dispose: () => {
      for (const coordinator of oauthCoordinators.values()) {
        coordinator.dispose()
      }
      for (const session of authSessions.values()) {
        session.invalidate()
      }
      authSessions.clear()
      oauthCoordinators.clear()
    },
  }
}

export function createCodexModelSource(
  createClient: (provider: ProviderConfigSchema) => CodexBackendClient,
): ProviderModelSource {
  return {
    async listModels(provider) {
      return (await createClient(provider).listModels()).map(toProviderModelDefinition)
    },
  }
}

function toProviderModelDefinition(model: CodexModelInfo): ProviderModelDefinition {
  return {
    id: model.id,
    name: model.name,
    contextLength: model.contextLength,
    maxOutputTokens: model.maxOutputTokens,
    capabilities: model.capabilities,
  }
}
