import type { ProviderIntegrationId, SecretRef, SecretStore } from '@ant-chat/shared'
import { createHash, randomUUID } from 'node:crypto'
import keytar from 'keytar'

export const DEFAULT_KEYCHAIN_SERVICE_NAME = 'ant-chat'

/**
 * Keychain 存取实现。
 *
 * serviceName 由 createRuntimeCore 按运行环境传入（development 用 ant-chat-dev）：
 * macOS Keychain 条目 ACL 绑定创建它的 app 签名，dev/prod 是两个不同签名的可执行文件，
 * 共用同一 service 会互相触发钥匙串授权弹窗，因此必须按环境隔离。
 */
export class KeychainSecretStore implements SecretStore {
  private readonly turnSecrets = new Map<string, string>()

  constructor(private readonly serviceName: string = DEFAULT_KEYCHAIN_SERVICE_NAME) {}

  private async setPassword(account: string, password: string): Promise<void> {
    await keytar.setPassword(this.serviceName, account, password)
  }

  private async getPassword(account: string): Promise<string | null> {
    return await keytar.getPassword(this.serviceName, account)
  }

  private async deletePassword(account: string): Promise<void> {
    await keytar.deletePassword(this.serviceName, account)
  }

  async saveProviderApiKey(input: { providerId: string, apiKey: string }): Promise<SecretRef> {
    const id = getProviderApiKeyId(input.providerId)
    await this.setPassword(id, input.apiKey)
    return { kind: 'secret_ref', id, scope: 'persistent' }
  }

  async getProviderApiKey(providerId: string): Promise<string | null> {
    return await this.getPassword(getProviderApiKeyId(providerId))
  }

  async deleteProviderApiKey(providerId: string): Promise<void> {
    await this.deletePassword(getProviderApiKeyId(providerId))
  }

  /** Integration 凭据只保存到 Keychain；命名空间绑定 Provider 和 Integration audience。 */
  async saveProviderIntegrationCredential(input: ProviderIntegrationCredentialScope & { value: string }): Promise<void> {
    await this.setPassword(getProviderIntegrationCredentialId(input), input.value)
  }

  async getProviderIntegrationCredential(input: ProviderIntegrationCredentialScope): Promise<string | null> {
    return await this.getPassword(getProviderIntegrationCredentialId(input))
  }

  async deleteProviderIntegrationCredential(input: ProviderIntegrationCredentialScope): Promise<void> {
    await this.deletePassword(getProviderIntegrationCredentialId(input))
  }

  async saveChannelCredential(input: { channelAccountId: string, value: string }): Promise<{ kind: 'secret_ref', id: string, scope: 'persistent' }> {
    const id = `channel:${input.channelAccountId}:credential`
    await this.setPassword(id, input.value)
    return { kind: 'secret_ref', id, scope: 'persistent' }
  }

  async deleteChannelCredential(channelAccountId: string): Promise<void> {
    await this.deletePassword(`channel:${channelAccountId}:credential`)
  }

  async saveMcpOAuthCredential(input: { endpoint: string, issuer: string, value: string }): Promise<void> {
    await this.setPassword(getMcpOAuthCredentialId(input.endpoint, input.issuer), input.value)
  }

  async getMcpOAuthCredential(input: { endpoint: string, issuer: string }): Promise<string | null> {
    return await this.getPassword(getMcpOAuthCredentialId(input.endpoint, input.issuer))
  }

  async deleteMcpOAuthCredential(input: { endpoint: string, issuer: string }): Promise<void> {
    await this.deletePassword(getMcpOAuthCredentialId(input.endpoint, input.issuer))
  }

  async getBrowserCookieEncryptionKey(): Promise<string | null> {
    return await this.getPassword('browser:cookie-encryption-key')
  }

  async saveBrowserCookieEncryptionKey(key: string): Promise<void> {
    await this.setPassword('browser:cookie-encryption-key', key)
  }

  async deleteBrowserCookieEncryptionKey(): Promise<void> {
    await this.deletePassword('browser:cookie-encryption-key')
  }

  async createTurnSecret(input: { runId: string, label: string, value: string }): Promise<SecretRef> {
    const id = `turn:${input.runId}:${randomUUID()}`
    this.turnSecrets.set(id, input.value)
    return { kind: 'secret_ref', id, scope: 'turn' }
  }

  async resolve(ref: SecretRef): Promise<string | null> {
    if (ref.scope === 'persistent') {
      return await this.getPassword(ref.id)
    }
    return this.turnSecrets.get(ref.id) ?? null
  }

  async resolveTurnSecret(ref: SecretRef, runId: string): Promise<string | null> {
    if (ref.scope !== 'turn' || !ref.id.startsWith(`turn:${runId}:`))
      return null
    return this.turnSecrets.get(ref.id) ?? null
  }

  async clearTurnSecrets(runId: string): Promise<void> {
    for (const id of this.turnSecrets.keys()) {
      if (id.startsWith(`turn:${runId}:`)) {
        this.turnSecrets.delete(id)
      }
    }
  }
}

export function getProviderApiKeyId(providerId: string): string {
  return `provider:${providerId}:api_key`
}

export interface ProviderIntegrationCredentialScope {
  providerId: string
  integrationId: ProviderIntegrationId
}

export function getProviderIntegrationCredentialId(input: ProviderIntegrationCredentialScope): string {
  return `provider:${input.providerId}:integration:${input.integrationId}:credential`
}

/**
 * OAuth 凭据与显示名无关。使用规范化 endpoint 和 issuer 的摘要，既避免路径注入，
 * 也让重命名 MCP server 不会丢失登录态。
 */
export function getMcpOAuthCredentialId(endpoint: string, issuer: string): string {
  const scope = `${normalizeMcpEndpoint(endpoint)}\u0000${normalizeIssuer(issuer)}`
  return `mcp:oauth:${createHash('sha256').update(scope).digest('hex')}`
}

function normalizeMcpEndpoint(endpoint: string): string {
  const url = new URL(endpoint)
  url.hash = ''
  url.username = ''
  url.password = ''
  url.hostname = url.hostname.toLowerCase()
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = ''
  }
  return url.toString()
}

function normalizeIssuer(issuer: string): string {
  const url = new URL(issuer)
  url.hash = ''
  url.username = ''
  url.password = ''
  url.hostname = url.hostname.toLowerCase()
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = ''
  }
  return url.toString()
}
