import type {
  AppRpcInput,
  McpConfigSchema,
  McpServerEditPatch,
  McpServerLifecycleResult,
  McpServerTestResult,
} from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { McpConfigSchema as McpConfigValidator } from '@ant-chat/shared'
import { MCPClientHub } from '../../../mcp'
import { Method, Module } from '../../decorators'

@Module('mcp')
export class McpModule implements RuntimeModuleMethods<'mcp'> {
  readonly clientHub: MCPClientHub
  private readonly lifecycleOperations = new Set<string>()

  constructor(
    private readonly core: Pick<RuntimeCore, 'data' | 'events' | 'logger'>,
    clientHub: MCPClientHub = new MCPClientHub(core.logger),
    private readonly createClientHub: () => MCPClientHub = () => new MCPClientHub(core.logger),
  ) {
    this.clientHub = clientHub
    this.clientHub.addStatusChangeCallback((serverName, status) => {
      if (!this.lifecycleOperations.has(serverName) && status !== 'connecting')
        core.events.emit('mcp:status-changed', { serverName, status })
    })
    this.clientHub.addErrorCallback((serverName, error) => {
      if (this.lifecycleOperations.has(serverName))
        return
      core.events.emit('mcp:status-changed', {
        error: error.message,
        serverName,
        status: 'disconnected',
      })
    })
  }

  initialize() {
    return this.clientHub.initializeMcpServers(this.core.data.mcpSettingsRepository.getMcpConfigs())
  }

  async dispose() {
    await Promise.all(this.clientHub.connections.map(connection => this.clientHub.deleteConnection(connection.server.name)))
  }

  @Method()
  getConfigs(_input?: AppRpcInput<'mcp.getConfigs'>) {
    return this.core.data.mcpSettingsRepository.getMcpConfigs()
  }

  @Method()
  getConfigByServerName(input: AppRpcInput<'mcp.getConfigByServerName'>) {
    return this.requireConfig(input.serverName)
  }

  @Method()
  getConnections(_input?: AppRpcInput<'mcp.getConnections'>) {
    return this.clientHub.connections.map(({ server }) => ({
      name: server.name,
      config: server.config,
      tools: server.tools ?? [],
      status: server.status,
    }))
  }

  @Method()
  getAllAvailableToolsList(_input: AppRpcInput<'mcp.getAllAvailableToolsList'>) {
    return this.clientHub.getAllAvailableToolsList()
  }

  @Method()
  async callTool(input: AppRpcInput<'mcp.callTool'>) {
    const result = await this.clientHub.callTool(input.serverName, input.toolName, input.toolArguments)
    return {
      content: (result.content ?? []).filter(item => item.type === 'text'),
      isError: result.isError,
    }
  }

  /** 安装配置并尝试启动；启动失败时保留配置，并返回统一失败状态。 */
  @Method()
  async installServer(input: AppRpcInput<'mcp.installServer'>): Promise<McpServerLifecycleResult> {
    const saved = this.core.data.mcpSettingsRepository.addMcpConfig(input.config)
    this.emitChanged(saved.serverName)
    return this.connect(saved, true)
  }

  /** 编辑配置；运行中的 server 由 module 自行停止、替换配置并重启。 */
  @Method()
  async editServer(input: AppRpcInput<'mcp.editServer'>): Promise<McpServerLifecycleResult> {
    const current = this.requireConfig(input.serverName)
    const next = mergeConfig(current, input.updates)
    if (next.serverName !== input.serverName && this.core.data.mcpSettingsRepository.getMcpConfigByServerName(next.serverName))
      throw new Error(`MCP server 已存在：${next.serverName}`)
    const connectionStatus = this.getConnectionStatus(input.serverName)
    const wasRunning = connectionStatus === 'connected' || connectionStatus === 'connecting'

    if (connectionStatus) {
      const stopped = await this.disconnect(current)
      if (stopped.error)
        return stopped
    }

    let saved: McpConfigSchema
    try {
      saved = this.core.data.mcpSettingsRepository.replaceMcpConfig(input.serverName, next)
    }
    catch (error) {
      if (wasRunning) {
        const recovery = await this.connect(current)
        if (recovery.error) {
          const updateError = error instanceof Error ? error.message : String(error)
          throw new Error(`更新 MCP server 失败（${updateError}），且旧连接恢复失败：${recovery.error}`)
        }
      }
      throw error
    }
    this.emitChanged(saved.serverName)
    return wasRunning ? this.connect(saved, true) : this.result(saved, 'disconnected')
  }

  /** 删除时先停止连接；停止失败则保留配置供调用方重试。 */
  @Method()
  async deleteServer(input: AppRpcInput<'mcp.deleteServer'>): Promise<McpServerLifecycleResult> {
    const config = this.requireConfig(input.serverName)
    const stopped = await this.disconnect(config)
    if (stopped.error)
      return stopped

    this.core.data.mcpSettingsRepository.deleteMcpConfig(input.serverName)
    this.emitChanged(input.serverName)
    return stopped
  }

  /** 从持久化配置启动，调用方不需要重新读取和传回配置。 */
  @Method()
  async startServer(input: AppRpcInput<'mcp.startServer'>): Promise<McpServerLifecycleResult> {
    const config = this.requireConfig(input.serverName)
    const status = this.getConnectionStatus(input.serverName)
    if (status === 'connected' || status === 'connecting')
      return this.result(config, status)
    if (status) {
      const stopped = await this.disconnect(config)
      if (stopped.error)
        return stopped
    }
    return this.connect(config)
  }

  /** 幂等停止，并返回与其他生命周期动作相同的结果结构。 */
  @Method()
  async stopServer(input: AppRpcInput<'mcp.stopServer'>): Promise<McpServerLifecycleResult> {
    return this.disconnect(this.requireConfig(input.serverName))
  }

  /** 使用隔离连接预检未保存配置，不污染持久化配置和正式连接状态。 */
  @Method()
  async testServer(input: AppRpcInput<'mcp.testServer'>): Promise<McpServerTestResult> {
    const config = McpConfigValidator.parse(input.config)
    const probe = this.createClientHub()
    try {
      await probe.connectToServer(config.serverName, config)
      const tools = probe.connections.find(connection => connection.server.name === config.serverName)?.server.tools
        ?? await probe.fetchToolsList(config.serverName)
      return { serverName: config.serverName, tools }
    }
    catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        serverName: config.serverName,
        tools: [],
      }
    }
    finally {
      await probe.deleteConnection(config.serverName).catch(() => false)
    }
  }

  private async connect(config: McpConfigSchema, configSaved = false): Promise<McpServerLifecycleResult> {
    this.lifecycleOperations.add(config.serverName)
    try {
      await this.clientHub.connectToServer(config.serverName, config)
      this.emitStatus(config.serverName, 'connected')
      return this.result(config, 'connected')
    }
    catch (error) {
      await this.clientHub.deleteConnection(config.serverName).catch(() => false)
      const message = error instanceof Error ? error.message : String(error)
      this.emitStatus(config.serverName, 'disconnected', message)
      return this.result(config, 'disconnected', message, configSaved)
    }
    finally {
      this.lifecycleOperations.delete(config.serverName)
    }
  }

  private async disconnect(config: McpConfigSchema): Promise<McpServerLifecycleResult> {
    this.lifecycleOperations.add(config.serverName)
    try {
      const stopped = await this.clientHub.deleteConnection(config.serverName)
      if (!stopped)
        throw new Error(`停止 MCP server 失败：${config.serverName}`)
      this.emitStatus(config.serverName, 'disconnected')
      return this.result(config, 'disconnected')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emitStatus(config.serverName, 'disconnected', message)
      return this.result(config, 'disconnected', message, false)
    }
    finally {
      this.lifecycleOperations.delete(config.serverName)
    }
  }

  private getConnectionStatus(serverName: string): McpServerLifecycleResult['status'] | undefined {
    return this.clientHub.connections.find(connection => connection.server.name === serverName)?.server.status
  }

  private requireConfig(serverName: string): McpConfigSchema {
    const config = this.core.data.mcpSettingsRepository.getMcpConfigByServerName(serverName)
    if (!config)
      throw new Error(`MCP server 不存在：${serverName}`)
    return config
  }

  private emitChanged(serverName: string): void {
    this.core.events.emit('mcp:changed', { serverName })
  }

  private emitStatus(serverName: string, status: 'connected' | 'disconnected', error?: string): void {
    this.core.events.emit('mcp:status-changed', {
      ...(error ? { error } : {}),
      serverName,
      status,
    })
  }

  private result(
    config: McpConfigSchema,
    status: McpServerLifecycleResult['status'],
    error?: string,
    configSaved?: boolean,
  ): McpServerLifecycleResult {
    return {
      ...(error ? { error } : {}),
      ...(error && configSaved !== undefined ? { configSaved } : {}),
      serverName: config.serverName,
      status,
      transportType: config.transportType,
    }
  }
}

function mergeConfig(current: McpConfigSchema, updates: McpServerEditPatch): McpConfigSchema {
  return McpConfigValidator.parse({ ...current, ...updates })
}
