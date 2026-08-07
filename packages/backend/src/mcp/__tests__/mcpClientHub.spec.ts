import type { ILogger } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { McpConnectionManager, McpOAuthProvider } from '../mcpClientHub'
import { McpOAuthCredentialStore } from '../oauthCredentialStore'
import { DEFAULT_MCP_TIMEOUT_SECONDS, resolveMcpToolTimeoutMs } from '../schema'

vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    connect = vi.fn(async () => {})
    close = vi.fn(async () => {})
    listTools = vi.fn(async () => ({ tools: [] }))
    callTool = vi.fn(async () => ({ content: [] }))
  },
  StreamableHTTPClientTransport: class {
    onerror: ((error: Error) => void) | undefined
    onclose: (() => void) | undefined
    constructor(public url: URL) {}
    async start() {}
    async close() {
      this.onclose?.()
    }
  },
  SSEClientTransport: class {},
  UnauthorizedError: class extends Error {},
}))

function createMockLogger(): ILogger {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
}

function createHttpConfig(url = 'https://mcp.example.com/mcp') {
  return {
    transportType: 'streamable-http',
    url,
    headers: {},
    authType: 'none',
  } as never
}

describe('resolveMcpToolTimeoutMs', () => {
  it('未传值时返回默认超时毫秒', () => {
    expect(resolveMcpToolTimeoutMs()).toBe(DEFAULT_MCP_TIMEOUT_SECONDS * 1000)
    expect(resolveMcpToolTimeoutMs()).toBe(10000)
  })

  it('传入整数秒时只转换一次', () => {
    expect(resolveMcpToolTimeoutMs(3)).toBe(3000)
  })

  it('传入小数秒时返回对应整数毫秒', () => {
    expect(resolveMcpToolTimeoutMs(0.5)).toBe(500)
  })
})

describe('mcpClientHub 日志行为', () => {
  it('删除连接失败时写入注入的运行日志', async () => {
    const logger = createMockLogger()
    const hub = new McpConnectionManager(logger)
    hub.connections.push({
      client: { close: vi.fn() },
      server: {
        config: '{}',
        name: 'broken-server',
        status: 'connected',
      },
      transport: {
        close: vi.fn(async () => {
          throw new Error('close failed')
        }),
      },
    } as never)

    await expect(hub.deleteConnection('broken-server')).resolves.toBe(false)

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to close transport for broken-server:',
      expect.any(Error),
    )
  })

  it('主动删除连接触发 onclose 时只记 info，不记 error', async () => {
    const logger = createMockLogger()
    const hub = new McpConnectionManager(logger)
    await hub.connectToServer('closing-server', createHttpConfig())

    await hub.deleteConnection('closing-server')

    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('Transport closed for "closing-server" (主动关闭)')
  })

  it('非主动关闭触发 onclose 时记 error', async () => {
    const logger = createMockLogger()
    const hub = new McpConnectionManager(logger)
    await hub.connectToServer('dropped-server', createHttpConfig())

    const connection = hub.connections.find(conn => conn.server.name === 'dropped-server')!
    ;(connection.transport as unknown as { onclose?: () => void }).onclose?.()

    expect(logger.error).toHaveBeenCalledWith('Transport closed for "dropped-server".')
  })
})

describe('mcp OAuth provider 凭据边界', () => {
  it('按 endpoint 和 issuer 读取持久 token，不使用 server 显示名作为凭据身份', async () => {
    const values = new Map<string, string>()
    const secretStore = {
      deleteMcpOAuthCredential: vi.fn(async ({ endpoint, issuer }: { endpoint: string, issuer: string }) => {
        values.delete(`${endpoint}\u0000${issuer}`)
      }),
      getMcpOAuthCredential: vi.fn(async ({ endpoint, issuer }: { endpoint: string, issuer: string }) => values.get(`${endpoint}\u0000${issuer}`) ?? null),
      saveMcpOAuthCredential: vi.fn(async ({ endpoint, issuer, value }: { endpoint: string, issuer: string, value: string }) => {
        values.set(`${endpoint}\u0000${issuer}`, value)
      }),
    }
    const endpoint = 'https://mcp.example.com/v1'
    const issuer = 'https://issuer.example.com'
    const credentialStore = new McpOAuthCredentialStore(secretStore)
    const first = new McpOAuthProvider(endpoint, 'http://127.0.0.1/callback', undefined, credentialStore)

    await first.saveClientInformation({ client_id: 'registered-client', issuer }, { issuer })
    await first.saveTokens({ access_token: 'access-token', issuer, token_type: 'bearer' }, { issuer })
    await first.saveDiscoveryState({ authorizationServerUrl: issuer } as never)

    const afterRestart = new McpOAuthProvider(endpoint, 'http://127.0.0.1/callback', undefined, credentialStore)

    await expect(afterRestart.clientInformation({ issuer })).resolves.toMatchObject({ client_id: 'registered-client' })
    await expect(afterRestart.tokens({ issuer })).resolves.toMatchObject({ access_token: 'access-token' })
    await expect(afterRestart.discoveryState()).resolves.toMatchObject({ authorizationServerUrl: issuer })
    expect(secretStore.saveMcpOAuthCredential).toHaveBeenCalledWith(expect.objectContaining({ endpoint, issuer }))
  })

  it('pkce verifier 只保留在授权尝试内存中', () => {
    const provider = new McpOAuthProvider('https://mcp.example.com/v1', 'http://127.0.0.1/callback')
    provider.saveCodeVerifier('ephemeral-verifier')

    expect(provider.codeVerifier()).toBe('ephemeral-verifier')
    expect(() => new McpOAuthProvider('https://mcp.example.com/v1', 'http://127.0.0.1/callback').codeVerifier()).toThrow('no code verifier available')
  })

  it('无 currentIssuer 时从 discovery 索引恢复 issuer 后清除全部凭据', async () => {
    const values = new Map<string, string>()
    const secretStore = {
      deleteMcpOAuthCredential: vi.fn(async ({ endpoint, issuer }: { endpoint: string, issuer: string }) => {
        values.delete(`${endpoint}\u0000${issuer}`)
      }),
      getMcpOAuthCredential: vi.fn(async ({ endpoint, issuer }: { endpoint: string, issuer: string }) => values.get(`${endpoint}\u0000${issuer}`) ?? null),
      saveMcpOAuthCredential: vi.fn(async ({ endpoint, issuer, value }: { endpoint: string, issuer: string, value: string }) => {
        values.set(`${endpoint}\u0000${issuer}`, value)
      }),
    }
    const endpoint = 'https://mcp.example.com/v1'
    const issuer = 'https://issuer.example.com'
    const credentialStore = new McpOAuthCredentialStore(secretStore)
    const first = new McpOAuthProvider(endpoint, 'http://127.0.0.1/callback', undefined, credentialStore)
    await first.saveTokens({ access_token: 'access-token', refresh_token: 'refresh-token', issuer, token_type: 'bearer' }, { issuer })
    await first.saveDiscoveryState({ authorizationServerUrl: issuer } as never)

    // 模拟新实例：从未通过 ctx 加载过 token，currentIssuer 为空。
    const provider = new McpOAuthProvider(endpoint, 'http://127.0.0.1/callback', undefined, credentialStore)
    await provider.invalidateCredentials('all')

    await expect(provider.tokens({ issuer })).resolves.toBeUndefined()
    expect(secretStore.deleteMcpOAuthCredential).toHaveBeenCalledWith(expect.objectContaining({ endpoint, issuer }))
  })
})
