import type { SecretRef, SecretStore } from '@ant-chat/shared'
import { createHash, randomUUID } from 'node:crypto'
import keytar from 'keytar'

const SERVICE_NAME = 'ant-chat'

export class KeychainSecretStore implements SecretStore {
  private readonly turnSecrets = new Map<string, string>()

  async saveProviderApiKey(input: { providerId: string, apiKey: string }): Promise<SecretRef> {
    const id = getProviderApiKeyId(input.providerId)
    await keytar.setPassword(SERVICE_NAME, id, input.apiKey)
    return { kind: 'secret_ref', id, scope: 'persistent' }
  }

  async getProviderApiKey(providerId: string): Promise<string | null> {
    return await keytar.getPassword(SERVICE_NAME, getProviderApiKeyId(providerId))
  }

  async deleteProviderApiKey(providerId: string): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, getProviderApiKeyId(providerId))
  }

  async saveChannelCredential(input: { channelAccountId: string, value: string }): Promise<{ kind: 'secret_ref', id: string, scope: 'persistent' }> {
    const id = `channel:${input.channelAccountId}:credential`
    await keytar.setPassword(SERVICE_NAME, id, input.value)
    return { kind: 'secret_ref', id, scope: 'persistent' }
  }

  async deleteChannelCredential(channelAccountId: string): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, `channel:${channelAccountId}:credential`)
  }

  async saveMcpOAuthCredential(input: { endpoint: string, issuer: string, value: string }): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, getMcpOAuthCredentialId(input.endpoint, input.issuer), input.value)
  }

  async getMcpOAuthCredential(input: { endpoint: string, issuer: string }): Promise<string | null> {
    return await keytar.getPassword(SERVICE_NAME, getMcpOAuthCredentialId(input.endpoint, input.issuer))
  }

  async deleteMcpOAuthCredential(input: { endpoint: string, issuer: string }): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, getMcpOAuthCredentialId(input.endpoint, input.issuer))
  }

  async getBrowserAuthStateKey(): Promise<string | null> {
    return await keytar.getPassword(SERVICE_NAME, 'browser:auth-state-key')
  }

  async saveBrowserAuthStateKey(key: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, 'browser:auth-state-key', key)
  }

  async deleteBrowserAuthStateKey(): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, 'browser:auth-state-key')
  }

  async createTurnSecret(input: { runId: string, label: string, value: string }): Promise<SecretRef> {
    const id = `turn:${input.runId}:${randomUUID()}`
    this.turnSecrets.set(id, input.value)
    return { kind: 'secret_ref', id, scope: 'turn' }
  }

  async resolve(ref: SecretRef): Promise<string | null> {
    if (ref.scope === 'persistent') {
      return await keytar.getPassword(SERVICE_NAME, ref.id)
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
