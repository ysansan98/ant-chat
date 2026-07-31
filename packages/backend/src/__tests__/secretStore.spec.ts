import { beforeEach, describe, expect, it, vi } from 'vitest'

const passwords = new Map<string, string>()

vi.mock('keytar', () => ({
  default: {
    setPassword: vi.fn(async (service: string, account: string, password: string) => {
      passwords.set(`${service}:${account}`, password)
    }),
    getPassword: vi.fn(async (service: string, account: string) => {
      return passwords.get(`${service}:${account}`) ?? null
    }),
    deletePassword: vi.fn(async (service: string, account: string) => {
      passwords.delete(`${service}:${account}`)
      return true
    }),
  },
}))

describe('keychainSecretStore', () => {
  beforeEach(() => {
    passwords.clear()
  })

  it('把 provider API Key 写入 keychain 并只返回引用', async () => {
    const { KeychainSecretStore } = await import('../secretStore')
    const store = new KeychainSecretStore()

    const ref = await store.saveProviderApiKey({ providerId: 'openai', apiKey: 'sk-test' })

    expect(ref).toEqual({
      kind: 'secret_ref',
      id: 'provider:openai:api_key',
      scope: 'persistent',
    })
    expect(await store.getProviderApiKey('openai')).toBe('sk-test')
    expect(await store.resolve(ref)).toBe('sk-test')
  })

  it('删除 provider API Key', async () => {
    const { KeychainSecretStore } = await import('../secretStore')
    const store = new KeychainSecretStore()
    await store.saveProviderApiKey({ providerId: 'openai', apiKey: 'sk-test' })

    await store.deleteProviderApiKey('openai')

    expect(await store.getProviderApiKey('openai')).toBeNull()
  })

  it('按 endpoint 和 issuer 隔离保存 MCP OAuth 资料，重命名 server 不会改变凭据作用域', async () => {
    const { KeychainSecretStore } = await import('../secretStore')
    const store = new KeychainSecretStore()
    const scope = {
      endpoint: 'https://MCP.example.com:443/api#ignored',
      issuer: 'https://AUTH.example.com:443/',
    }

    await store.saveMcpOAuthCredential({ ...scope, value: '{"refresh_token":"secret"}' })

    expect(await store.getMcpOAuthCredential({
      endpoint: 'https://mcp.example.com/api',
      issuer: 'https://auth.example.com/',
    })).toBe('{"refresh_token":"secret"}')
    expect(await store.getMcpOAuthCredential({
      endpoint: 'https://mcp.example.com/other',
      issuer: scope.issuer,
    })).toBeNull()
  })

  it('删除 MCP OAuth 资料不会影响同一 endpoint 的其他 issuer', async () => {
    const { KeychainSecretStore } = await import('../secretStore')
    const store = new KeychainSecretStore()
    const endpoint = 'https://mcp.example.com/api'
    await store.saveMcpOAuthCredential({ endpoint, issuer: 'https://issuer-a.example.com', value: 'a' })
    await store.saveMcpOAuthCredential({ endpoint, issuer: 'https://issuer-b.example.com', value: 'b' })

    await store.deleteMcpOAuthCredential({ endpoint, issuer: 'https://issuer-a.example.com' })

    expect(await store.getMcpOAuthCredential({ endpoint, issuer: 'https://issuer-a.example.com' })).toBeNull()
    expect(await store.getMcpOAuthCredential({ endpoint, issuer: 'https://issuer-b.example.com' })).toBe('b')
  })

  it('按 runId 清理 turn secret', async () => {
    const { KeychainSecretStore } = await import('../secretStore')
    const store = new KeychainSecretStore()
    const ref = await store.createTurnSecret({ runId: 'run-1', label: 'token', value: 'secret-token' })

    expect(await store.resolve(ref)).toBe('secret-token')
    expect(await store.resolveTurnSecret(ref, 'run-1')).toBe('secret-token')
    expect(await store.resolveTurnSecret(ref, 'run-2')).toBeNull()

    await store.clearTurnSecrets('run-1')

    expect(await store.resolve(ref)).toBeNull()
  })
})
