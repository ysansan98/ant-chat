import type { McpConfigSchema, McpServer, McpTool } from '@ant-chat/shared'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpSettingsRepository, McpSettingsStore } from '../../../../data/mcp'
import { PermissionsFileStore } from '../../../../data/permissions'
import { RuntimeEventBus } from '../../../../events'
import { McpModule } from '..'
import { McpConnectionManager } from '../../../../mcp'

interface TestConnection {
  server: McpServer
}

class FakeMcpClientHub {
  connections: TestConnection[] = []
  failNextConnect?: Error
  failNextDelete?: Error
  /** 下一次 connectToServer 模拟 SDK 需要 OAuth 授权（返回 false）。 */
  nextConnectNeedsAuth = false
  pendingOAuthUrl: string | undefined
  preparedOAuthState: string | undefined
  invalidateOAuthCredentials = vi.fn(async () => {})
  oauthRedirectUrl: string | undefined
  private readonly statusCallbacks: Array<(name: string, status: McpServer['status']) => void> = []
  private readonly errorCallbacks: Array<(name: string, error: Error) => void> = []

  addStatusChangeCallback(callback: (name: string, status: McpServer['status']) => void) {
    this.statusCallbacks.push(callback)
  }

  addErrorCallback(callback: (name: string, error: Error) => void) {
    this.errorCallbacks.push(callback)
  }

  async initializeMcpServers(configs: McpConfigSchema[]) {
    for (const config of configs)
      await this.connectToServer(config.serverName, config)
  }

  async connectToServer(name: string, config: McpConfigSchema) {
    if (this.failNextConnect) {
      const error = this.failNextConnect
      this.failNextConnect = undefined
      this.errorCallbacks.forEach(callback => callback(name, error))
      throw error
    }
    if (this.nextConnectNeedsAuth) {
      this.nextConnectNeedsAuth = false
      return false
    }
    this.connections = this.connections.filter(connection => connection.server.name !== name)
    this.connections.push({
      server: {
        config: JSON.stringify(config),
        name,
        status: 'connected',
        tools: [],
      },
    })
    this.statusCallbacks.forEach(callback => callback(name, 'connected'))
    return true
  }

  async deleteConnection(name: string) {
    if (this.failNextDelete) {
      const error = this.failNextDelete
      this.failNextDelete = undefined
      throw error
    }
    this.connections = this.connections.filter(connection => connection.server.name !== name)
    this.statusCallbacks.forEach(callback => callback(name, 'disconnected'))
    return true
  }

  getAllAvailableToolsList(): McpTool[] {
    return []
  }

  async callTool() {
    return { content: [] }
  }

  async fetchToolsList(): Promise<McpTool[]> {
    return []
  }

  getPendingOAuthUrl(_name: string): string | undefined {
    return this.pendingOAuthUrl
      ? `${this.pendingOAuthUrl}?state=${this.preparedOAuthState ?? ''}`
      : undefined
  }

  getOAuthRedirectUrl(): string | undefined {
    return this.oauthRedirectUrl ?? 'http://localhost:9999/callback'
  }

  prepareOAuthState(_name: string, state: string): void {
    this.preparedOAuthState = state
  }

  setOAuthRedirectUrl(url: string): void {
    this.oauthRedirectUrl = url
  }
}

/** initialize 改为后台自动连接，测试需显式等待后台任务完成。 */
async function flushAutoConnect(module: McpModule): Promise<void> {
  await (module as unknown as { autoConnectPromise?: Promise<void> }).autoConnectPromise
}

describe('mcp module 生命周期', () => {
  let dir: string
  let repository: McpSettingsRepository
  let events: RuntimeEventBus
  let hub: FakeMcpClientHub
  let module: McpModule
  let permissionsFileStore: PermissionsFileStore

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-mcp-module-'))
    repository = new McpSettingsRepository(new McpSettingsStore({ filePath: path.join(dir, 'mcp.json') }))
    events = new RuntimeEventBus()
    hub = new FakeMcpClientHub()
    permissionsFileStore = new PermissionsFileStore(path.join(dir, 'permissions.json'))
    module = new McpModule({
      data: { mcpSettingsRepository: repository, permissionsFileStore },
      events,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      paths: { mcpSettingsFile: path.join(dir, 'mcp.json') },
    } as never, hub as never)
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
  })

  it('安装由 module 一次完成持久化、连接和事件发布', async () => {
    const changed: unknown[] = []
    const statuses: unknown[] = []
    events.on('mcp:changed', event => changed.push(event))
    events.on('mcp:status-changed', event => statuses.push(event))

    await expect(module.installServer({ config: stdioConfig('demo') })).resolves.toEqual({
      serverName: 'demo',
      status: 'connected',
      transportType: 'stdio',
    })

    expect(repository.getMcpConfigByServerName('demo')).toEqual(expect.objectContaining({ serverName: 'demo', transportType: 'stdio' }))
    expect(hub.connections.map(connection => connection.server.name)).toEqual(['demo'])
    expect(changed).toEqual([{ serverName: 'demo' }])
    expect(statuses).toEqual([{ serverName: 'demo', status: 'connected' }])
  })

  it('安装连接失败时保留配置并通过结果和事件暴露同一错误', async () => {
    const statuses: unknown[] = []
    events.on('mcp:status-changed', event => statuses.push(event))
    hub.failNextConnect = new Error('connection refused')

    await expect(module.installServer({ config: stdioConfig('demo') })).resolves.toEqual({
      configSaved: true,
      error: 'connection refused',
      serverName: 'demo',
      status: 'disconnected',
      transportType: 'stdio',
    })

    expect(repository.getMcpConfigByServerName('demo')).toEqual(expect.objectContaining({ serverName: 'demo', transportType: 'stdio' }))
    expect(statuses).toEqual([{
      error: 'connection refused',
      serverName: 'demo',
      status: 'disconnected',
    }])
  })

  it('编辑前停止失败会明确返回配置未保存', async () => {
    await module.installServer({ config: stdioConfig('demo') })
    hub.failNextDelete = new Error('停止失败')

    await expect(module.editServer({
      serverName: 'demo',
      updates: { command: 'bun' },
    })).resolves.toEqual({
      configSaved: false,
      error: '停止失败',
      serverName: 'demo',
      status: 'disconnected',
      transportType: 'stdio',
    })

    expect(repository.getMcpConfigByServerName('demo')).toEqual(expect.objectContaining({ serverName: 'demo', transportType: 'stdio' }))
  })

  it('编辑运行中 server 时由 module 完成重命名、配置替换和重连', async () => {
    await module.installServer({ config: stdioConfig('before') })
    permissionsFileStore.addRule('global', undefined, {
      kind: 'mcp-tool',
      serverName: 'before',
      toolName: 'inspect',
    })

    await expect(module.editServer({
      serverName: 'before',
      updates: { ...stdioConfig('after'), command: 'bun' },
    })).resolves.toEqual({ serverName: 'after', status: 'connected', transportType: 'stdio' })

    expect(repository.getMcpConfigByServerName('before')).toBeNull()
    expect(repository.getMcpConfigByServerName('after')).toEqual(expect.objectContaining({ serverName: 'after', command: 'bun' }))
    expect(hub.connections.map(connection => connection.server.name)).toEqual(['after'])
    expect(permissionsFileStore.listAll().global).toEqual([
      expect.objectContaining({ kind: 'mcp-tool', serverName: 'after', toolName: 'inspect' }),
    ])
  })

  it('start、stop、delete 只接收 server 名称并共享持久化配置', async () => {
    await module.installServer({ config: stdioConfig('demo') })
    await expect(module.stopServer({ serverName: 'demo' })).resolves.toEqual({ serverName: 'demo', status: 'disconnected', transportType: 'stdio' })
    await expect(module.startServer({ serverName: 'demo' })).resolves.toEqual({ serverName: 'demo', status: 'connected', transportType: 'stdio' })
    await expect(module.deleteServer({ serverName: 'demo', deletePermissionRules: false })).resolves.toEqual({ serverName: 'demo', status: 'disconnected', transportType: 'stdio' })

    expect(repository.getMcpConfigByServerName('demo')).toBeNull()
    expect(hub.connections).toEqual([])
  })

  it('initialize 只启动启用状态的 server', async () => {
    repository.addMcpConfig({ ...stdioConfig('disabled'), enabled: false })
    repository.addMcpConfig(stdioConfig('enabled'))

    await module.initialize()
    await flushAutoConnect(module)

    expect(hub.connections.map(connection => connection.server.name)).toEqual(['enabled'])
    expect(repository.getMcpConfigByServerName('disabled')).toEqual(expect.objectContaining({ enabled: false }))
    expect(repository.getMcpConfigByServerName('enabled')).toEqual(expect.objectContaining({ enabled: true }))
  })

  it('setServerEnabled 禁用时停止连接并持久化，启用时立即连接', async () => {
    await module.installServer({ config: stdioConfig('demo') })

    await expect(module.setServerEnabled({ serverName: 'demo', enabled: false })).resolves.toEqual({
      configSaved: true,
      serverName: 'demo',
      status: 'disconnected',
      transportType: 'stdio',
    })
    expect(repository.getMcpConfigByServerName('demo')).toEqual(expect.objectContaining({ enabled: false }))
    expect(hub.connections).toEqual([])

    await expect(module.setServerEnabled({ serverName: 'demo', enabled: true })).resolves.toEqual({
      serverName: 'demo',
      status: 'connected',
      transportType: 'stdio',
    })
    expect(repository.getMcpConfigByServerName('demo')).toEqual(expect.objectContaining({ enabled: true }))
    expect(hub.connections.map(connection => connection.server.name)).toEqual(['demo'])
  })

  it('setServerEnabled 启用连接失败时保留已保存的配置', async () => {
    await module.installServer({ config: stdioConfig('demo') })
    await module.setServerEnabled({ serverName: 'demo', enabled: false })
    hub.failNextConnect = new Error('connection refused')

    await expect(module.setServerEnabled({ serverName: 'demo', enabled: true })).resolves.toEqual({
      configSaved: true,
      error: 'connection refused',
      serverName: 'demo',
      status: 'disconnected',
      transportType: 'stdio',
    })

    expect(repository.getMcpConfigByServerName('demo')).toEqual(expect.objectContaining({ enabled: true }))
  })

  it('oauth 凭据失效时清除凭据并重新发起浏览器授权', async () => {
    const openAuthorization = vi.fn(async () => {})
    module = new McpModule({
      data: { mcpSettingsRepository: repository, permissionsFileStore },
      events,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      oauthCallbackHost: {
        redirectUrl: 'http://localhost:9999/callback',
        openAuthorization,
        subscribeCallback: vi.fn(),
      },
      secretStore: {},
    } as never, hub as never)

    const oauthConfig: McpConfigSchema = {
      enabled: true,
      serverId: crypto.randomUUID(),
      serverName: 'demo',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com',
      authType: 'oauth',
    }
    await module.installServer({ config: oauthConfig })
    await module.stopServer({ serverName: 'demo' })

    hub.failNextConnect = new Error('Error POSTing to endpoint: {"message":"Unauthorized"}')
    hub.nextConnectNeedsAuth = true
    hub.pendingOAuthUrl = 'https://auth.example.com/authorize'

    await expect(module.startServer({ serverName: 'demo' })).resolves.toEqual({
      serverName: 'demo',
      status: 'connecting',
      error: 'OAuth authorization required',
      transportType: 'streamable-http',
    })

    expect(hub.invalidateOAuthCredentials).toHaveBeenCalledWith('demo')
    expect(hub.preparedOAuthState).toBeTruthy()
    expect(openAuthorization).toHaveBeenCalledWith(expect.stringContaining('state='))
  })

  it('应用启动自动连接 oauth server 需要授权时不弹窗，保持未运行', async () => {
    const openAuthorization = vi.fn(async () => {})
    const statuses: unknown[] = []
    events.on('mcp:status-changed', event => statuses.push(event))
    module = new McpModule({
      data: { mcpSettingsRepository: repository, permissionsFileStore },
      events,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      oauthCallbackHost: {
        redirectUrl: 'http://localhost:9999/callback',
        openAuthorization,
        subscribeCallback: vi.fn(),
      },
      secretStore: {},
    } as never, hub as never)

    repository.addMcpConfig({
      enabled: true,
      serverName: 'demo',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com',
      authType: 'oauth',
    })
    hub.nextConnectNeedsAuth = true
    hub.pendingOAuthUrl = 'https://auth.example.com/authorize'

    await module.initialize()
    await flushAutoConnect(module)

    expect(openAuthorization).not.toHaveBeenCalled()
    expect(hub.connections).toEqual([])
    expect(statuses).toContainEqual(expect.objectContaining({
      serverName: 'demo',
      status: 'disconnected',
      error: '需要授权后才能连接，请在 MCP 设置页点击启动重新授权',
    }))
  })

  it('删除 server 时按输入保留或删除同名权限规则', async () => {
    await module.installServer({ config: stdioConfig('demo') })
    permissionsFileStore.addRule('global', undefined, {
      kind: 'mcp-tool',
      serverName: 'demo',
      toolName: 'inspect',
    })

    await module.deleteServer({ serverName: 'demo', deletePermissionRules: false })
    expect(permissionsFileStore.countMcpServerRules('demo')).toBe(1)

    await module.installServer({ config: stdioConfig('demo') })
    await module.deleteServer({ serverName: 'demo', deletePermissionRules: true })
    expect(permissionsFileStore.countMcpServerRules('demo')).toBe(0)
  })

  it('权限迁移失败时回滚重命名配置、权限和运行连接', async () => {
    await module.installServer({ config: stdioConfig('before') })
    permissionsFileStore.addRule('global', undefined, {
      kind: 'mcp-tool',
      serverName: 'before',
      toolName: 'inspect',
    })
    vi.spyOn(permissionsFileStore, 'migrateMcpServerName').mockImplementationOnce(() => {
      throw new Error('permissions write failed')
    })

    await expect(module.editServer({
      serverName: 'before',
      updates: { serverName: 'after' },
    })).rejects.toThrow('MCP 重命名事务失败：permissions write failed')

    expect(repository.getMcpConfigByServerName('before')).toEqual(expect.objectContaining({ serverName: 'before', transportType: 'stdio' }))
    expect(repository.getMcpConfigByServerName('after')).toBeNull()
    expect(permissionsFileStore.listAll().global).toEqual([
      expect.objectContaining({ serverName: 'before', toolName: 'inspect' }),
    ])
    expect(hub.connections.map(connection => connection.server.name)).toEqual(['before'])
  })

  it('删除权限失败时恢复 server 配置、权限和运行连接', async () => {
    await module.installServer({ config: stdioConfig('demo') })
    permissionsFileStore.addRule('global', undefined, {
      kind: 'mcp-tool',
      serverName: 'demo',
      toolName: 'inspect',
    })
    vi.spyOn(permissionsFileStore, 'deleteMcpServerRules').mockImplementationOnce(() => {
      throw new Error('permissions delete failed')
    })

    await expect(module.deleteServer({
      serverName: 'demo',
      deletePermissionRules: true,
    })).rejects.toThrow('删除 MCP server 事务失败：permissions delete failed')

    expect(repository.getMcpConfigByServerName('demo')).toEqual(expect.objectContaining({ serverName: 'demo', transportType: 'stdio' }))
    expect(permissionsFileStore.countMcpServerRules('demo')).toBe(1)
    expect(hub.connections.map(connection => connection.server.name)).toEqual(['demo'])
  })

  it('运行中编辑持久化失败时恢复旧连接和旧配置', async () => {
    await module.installServer({ config: stdioConfig('demo') })
    vi.spyOn(repository, 'replaceMcpConfig').mockImplementationOnce(() => {
      throw new Error('settings write failed')
    })

    await expect(module.editServer({
      serverName: 'demo',
      updates: { command: 'bun' },
    })).rejects.toThrow('settings write failed')

    expect(repository.getMcpConfigByServerName('demo')).toEqual(expect.objectContaining({ serverName: 'demo', transportType: 'stdio' }))
    expect(hub.connections).toEqual([
      expect.objectContaining({
        server: expect.objectContaining({ name: 'demo', status: 'connected' }),
      }),
    ])
  })

  it('连接预检使用隔离 hub，不保存配置或污染正式连接', async () => {
    const probeHub = new FakeMcpClientHub()
    const previewTools: McpTool[] = [{
      name: 'inspect',
      inputSchema: { type: 'object', properties: {}, required: [] },
    }]
    const connectProbe = probeHub.connectToServer.bind(probeHub)
    probeHub.connectToServer = vi.fn(async (name, config) => {
      await connectProbe(name, config)
      probeHub.connections[0].server.tools = previewTools
      return true
    })
    module = new McpModule({
      data: { mcpSettingsRepository: repository, permissionsFileStore },
      events,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      paths: { mcpSettingsFile: path.join(dir, 'mcp.json') },
    } as never, hub as never, () => probeHub as never)

    await expect(module.testServer({ config: stdioConfig('preview') })).resolves.toEqual({
      serverName: 'preview',
      tools: previewTools,
    })

    expect(repository.getMcpConfigs()).toEqual([])
    expect(hub.connections).toEqual([])
    expect(probeHub.connections).toEqual([])
  })

  it('oauth 测试仅通过本地 callback host 完成，不暴露回调参数 RPC', async () => {
    let oauthCompleted = false
    let preparedState = ''
    let callbackHandler: ((params: URLSearchParams) => Promise<void>) | undefined

    // mock McpConnectionManager 的实例方法
    async function mockConnect(this: McpConnectionManager, name: string, config: McpConfigSchema) {
      if (!oauthCompleted && 'authType' in config && config.authType === 'oauth') {
        return false
      }
      this.connections.push({
        client: {} as never,
        server: { config: JSON.stringify(config), name, status: 'connected' as const, tools: [{ name: 'tool1', inputSchema: { type: 'object' as const, properties: {}, required: [] } }] },
        transport: {} as never,
      })
      return true
    }
    vi.spyOn(McpConnectionManager.prototype, 'connectToServer').mockImplementation(mockConnect)
    vi.spyOn(McpConnectionManager.prototype, 'finishOAuthAuth').mockImplementation(async function mockFinish(this: McpConnectionManager, name: string) {
      oauthCompleted = true
      const existingConn = this.connections.find(c => c.server.name === name)
      const config = existingConn
        ? JSON.parse(existingConn.server.config) as McpConfigSchema
        : { enabled: true, serverId: crypto.randomUUID(), serverName: name, transportType: 'streamable-http' as const, url: 'https://mcp.example.com' }
      return mockConnect.call(this, name, config)
    })
    vi.spyOn(McpConnectionManager.prototype, 'deleteConnection').mockImplementation(async () => true)
    vi.spyOn(McpConnectionManager.prototype, 'prepareOAuthState').mockImplementation((_name, state) => {
      preparedState = state
    })
    vi.spyOn(McpConnectionManager.prototype, 'getPendingOAuthUrl').mockImplementation(() => `https://auth.example.com/authorize?state=${preparedState}`)
    vi.spyOn(McpConnectionManager.prototype, 'fetchToolsList').mockImplementation(async () => [{ name: 'tool1', inputSchema: { type: 'object' as const, properties: {}, required: [] } }])

    module = new McpModule({
      data: { mcpSettingsRepository: repository, permissionsFileStore },
      events,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      oauthCallbackHost: {
        redirectUrl: 'http://localhost:9999/callback',
        openAuthorization: vi.fn(),
        subscribeCallback(handler: (params: URLSearchParams) => Promise<void>) {
          callbackHandler = handler
          return () => {}
        },
      },
      secretStore: {},
    } as never, hub as never)

    const oauthConfig: McpConfigSchema = {
      enabled: true,
      serverId: crypto.randomUUID(),
      serverName: 'oauth-server',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com',
      authType: 'oauth',
    }

    // 阶段1：测试连接 → 返回 oauthRequired
    const result1 = await module.testServer({ config: oauthConfig })
    expect(result1.oauthRequired).toBe(true)
    expect(result1.attemptId).toBeTruthy()
    expect(result1.tools).toEqual([])

    // 阶段2：浏览器回调只进入 host；前端没有 state/code 传递能力。
    await callbackHandler!(new URLSearchParams({ code: '123', state: preparedState }))
    const result2 = await module.getTestResult({ attemptId: result1.attemptId! })
    expect(result2.error).toBeUndefined()
    expect(result2.tools).toEqual([{ name: 'tool1', inputSchema: { type: 'object', properties: {}, required: [] } }])
  })
})

function stdioConfig(serverName: string): McpConfigSchema {
  return {
    args: ['server.js'],
    command: 'node',
    description: '测试 server',
    enabled: true,
    serverId: crypto.randomUUID(),
    serverName,
    transportType: 'stdio',
  }
}
