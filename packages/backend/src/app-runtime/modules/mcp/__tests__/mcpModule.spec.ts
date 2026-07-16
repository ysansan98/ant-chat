import type { McpConfigSchema, McpServer, McpTool } from '@ant-chat/shared'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpSettingsRepository, McpSettingsStore } from '../../../../data/mcp'
import { RuntimeEventBus } from '../../../../events'
import { McpModule } from '..'

interface TestConnection {
  server: McpServer
}

class FakeMcpClientHub {
  connections: TestConnection[] = []
  failNextConnect?: Error
  failNextDelete?: Error
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
}

describe('mcp module 生命周期', () => {
  let dir: string
  let repository: McpSettingsRepository
  let events: RuntimeEventBus
  let hub: FakeMcpClientHub
  let module: McpModule

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-mcp-module-'))
    repository = new McpSettingsRepository(new McpSettingsStore({ filePath: path.join(dir, 'mcp.json') }))
    events = new RuntimeEventBus()
    hub = new FakeMcpClientHub()
    module = new McpModule({
      data: { mcpSettingsRepository: repository },
      events,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
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

    expect(repository.getMcpConfigByServerName('demo')).toEqual(stdioConfig('demo'))
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

    expect(repository.getMcpConfigByServerName('demo')).toEqual(stdioConfig('demo'))
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

    expect(repository.getMcpConfigByServerName('demo')).toEqual(stdioConfig('demo'))
  })

  it('编辑运行中 server 时由 module 完成重命名、配置替换和重连', async () => {
    await module.installServer({ config: stdioConfig('before') })

    await expect(module.editServer({
      serverName: 'before',
      updates: { ...stdioConfig('after'), command: 'bun' },
    })).resolves.toEqual({ serverName: 'after', status: 'connected', transportType: 'stdio' })

    expect(repository.getMcpConfigByServerName('before')).toBeNull()
    expect(repository.getMcpConfigByServerName('after')).toEqual({ ...stdioConfig('after'), command: 'bun' })
    expect(hub.connections.map(connection => connection.server.name)).toEqual(['after'])
  })

  it('start、stop、delete 只接收 server 名称并共享持久化配置', async () => {
    await module.installServer({ config: stdioConfig('demo') })
    await expect(module.stopServer({ serverName: 'demo' })).resolves.toEqual({ serverName: 'demo', status: 'disconnected', transportType: 'stdio' })
    await expect(module.startServer({ serverName: 'demo' })).resolves.toEqual({ serverName: 'demo', status: 'connected', transportType: 'stdio' })
    await expect(module.deleteServer({ serverName: 'demo' })).resolves.toEqual({ serverName: 'demo', status: 'disconnected', transportType: 'stdio' })

    expect(repository.getMcpConfigByServerName('demo')).toBeNull()
    expect(hub.connections).toEqual([])
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

    expect(repository.getMcpConfigByServerName('demo')).toEqual(stdioConfig('demo'))
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
    })
    module = new McpModule({
      data: { mcpSettingsRepository: repository },
      events,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    } as never, hub as never, () => probeHub as never)

    await expect(module.testServer({ config: stdioConfig('preview') })).resolves.toEqual({
      serverName: 'preview',
      tools: previewTools,
    })

    expect(repository.getMcpConfigs()).toEqual([])
    expect(hub.connections).toEqual([])
    expect(probeHub.connections).toEqual([])
  })
})

function stdioConfig(serverName: string): McpConfigSchema {
  return {
    args: ['server.js'],
    command: 'node',
    description: '测试 server',
    icon: 'terminal',
    serverName,
    transportType: 'stdio',
  }
}
