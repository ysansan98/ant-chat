import type { SecretStore } from '@ant-chat/shared'
import { createHash } from 'node:crypto'

export interface McpOAuthCredentialScope {
  endpoint: string
  issuer: string
}

interface McpOAuthDiscoveryIndex {
  issuer: string
}

/**
 * MCP SDK 的 OAuth 资料（token、DCR client information、discovery state）
 * 统一作为一个 JSON 文档交给 Keychain。这里不解释资料内容，以免业务层复制协议状态。
 */
export class McpOAuthCredentialStore {
  constructor(private readonly secretStore: Pick<SecretStore, 'deleteMcpOAuthCredential' | 'getMcpOAuthCredential' | 'saveMcpOAuthCredential'>) {}

  async load<T>(scope: McpOAuthCredentialScope): Promise<T | undefined> {
    const stored = await this.secretStore.getMcpOAuthCredential(scope)
    if (!stored) {
      return undefined
    }

    try {
      return JSON.parse(stored) as T
    }
    catch {
      await this.secretStore.deleteMcpOAuthCredential(scope)
      return undefined
    }
  }

  async save(scope: McpOAuthCredentialScope, credential: unknown): Promise<void> {
    await this.secretStore.saveMcpOAuthCredential({ ...scope, value: JSON.stringify(credential) })
  }

  async delete(scope: McpOAuthCredentialScope): Promise<void> {
    await this.secretStore.deleteMcpOAuthCredential(scope)
  }

  /**
   * discovery 在 SDK 首次读取时没有 issuer 参数。索引只保存已验证的 issuer，
   * 实际 discovery state 仍与 token/client info 一样按 endpoint + issuer 保存。
   */
  async loadDiscoveryIssuer(endpoint: string): Promise<string | undefined> {
    const index = await this.load<McpOAuthDiscoveryIndex>({ endpoint, issuer: discoveryIndexIssuer(endpoint) })
    return index?.issuer
  }

  async saveDiscoveryIssuer(endpoint: string, issuer: string): Promise<void> {
    await this.save({ endpoint, issuer: discoveryIndexIssuer(endpoint) }, { issuer })
  }

  async deleteDiscoveryIssuer(endpoint: string): Promise<void> {
    await this.delete({ endpoint, issuer: discoveryIndexIssuer(endpoint) })
  }
}

function discoveryIndexIssuer(endpoint: string): string {
  const digest = createHash('sha256').update(endpoint).digest('hex')
  return `https://ant-chat.invalid/mcp-oauth-discovery/${digest}`
}
