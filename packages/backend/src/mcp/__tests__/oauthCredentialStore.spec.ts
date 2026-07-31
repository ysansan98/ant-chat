import type { SecretStore } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { McpOAuthCredentialStore } from '../oauthCredentialStore'

function createSecretStore(stored: string | null): Pick<SecretStore, 'deleteMcpOAuthCredential' | 'getMcpOAuthCredential' | 'saveMcpOAuthCredential'> {
  return {
    deleteMcpOAuthCredential: vi.fn(async () => {}),
    getMcpOAuthCredential: vi.fn(async () => stored),
    saveMcpOAuthCredential: vi.fn(async () => {}),
  }
}

describe('mcp oauth credential store', () => {
  it('损坏的 keychain OAuth 资料会被删除并按未登录处理', async () => {
    const secretStore = createSecretStore('{invalid json')
    const store = new McpOAuthCredentialStore(secretStore)

    await expect(store.load({ endpoint: 'https://mcp.example.com', issuer: 'https://issuer.example.com' })).resolves.toBeUndefined()
    expect(secretStore.deleteMcpOAuthCredential).toHaveBeenCalledWith({ endpoint: 'https://mcp.example.com', issuer: 'https://issuer.example.com' })
  })

  it('保存和读取时完整保留 SDK OAuth 状态', async () => {
    const secretStore = createSecretStore('{"tokens":{"refresh_token":"secret"}}')
    const store = new McpOAuthCredentialStore(secretStore)
    const scope = { endpoint: 'https://mcp.example.com', issuer: 'https://issuer.example.com' }

    await store.save(scope, { tokens: { refresh_token: 'new-secret' }, discoveryState: { resource: 'https://mcp.example.com' } })

    expect(secretStore.saveMcpOAuthCredential).toHaveBeenCalledWith({
      ...scope,
      value: '{"tokens":{"refresh_token":"new-secret"},"discoveryState":{"resource":"https://mcp.example.com"}}',
    })
    await expect(store.load<{ tokens: { refresh_token: string } }>(scope)).resolves.toEqual({ tokens: { refresh_token: 'secret' } })
  })
})
