import type { AppRpcInput } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { MCPClientHub } from '../../../mcp'
import { Method, Module } from '../../decorators'

@Module('mcp')
export class McpModule implements RuntimeModuleMethods<'mcp'> {
  readonly clientHub: MCPClientHub

  constructor(private readonly core: Pick<RuntimeCore, 'data' | 'events' | 'logger'>) {
    this.clientHub = new MCPClientHub(core.logger)
    this.clientHub.addStatusChangeCallback((serverName, status) => {
      if (status !== 'connecting') {
        core.events.emit('mcp:status-changed', { serverName, status })
      }
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
    const config = this.core.data.mcpSettingsRepository.getMcpConfigByServerName(input.serverName)
    if (!config)
      throw new Error(`MCP server not found: ${input.serverName}`)
    return config
  }

  @Method()
  addConfig(input: AppRpcInput<'mcp.addConfig'>) {
    const config = this.core.data.mcpSettingsRepository.addMcpConfig(input.config)
    this.core.events.emit('mcp:changed', { serverName: config.serverName })
    return config
  }

  @Method()
  updateConfig(input: AppRpcInput<'mcp.updateConfig'>) {
    const config = this.core.data.mcpSettingsRepository.updateMcpConfig(input.config)
    this.core.events.emit('mcp:changed', { serverName: config.serverName })
    return config
  }

  @Method()
  deleteConfig(input: AppRpcInput<'mcp.deleteConfig'>) {
    this.core.data.mcpSettingsRepository.deleteMcpConfig(input.serverName)
    this.core.events.emit('mcp:changed', { serverName: input.serverName })
    return null
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

  @Method()
  async connectMcpServer(input: AppRpcInput<'mcp.connectMcpServer'>) {
    await this.clientHub.connectToServer(input.name, input.config)
    return null
  }

  @Method()
  async disconnectMcpServer(input: AppRpcInput<'mcp.disconnectMcpServer'>) {
    await this.clientHub.deleteConnection(input.name)
    return null
  }

  @Method()
  async reconnectMcpServer(input: AppRpcInput<'mcp.reconnectMcpServer'>) {
    await this.clientHub.deleteConnection(input.name)
    await this.clientHub.connectToServer(input.name, input.config)
    return null
  }

  @Method()
  fetchMcpServerTools(input: AppRpcInput<'mcp.fetchMcpServerTools'>) {
    return this.clientHub.fetchToolsList(input.name)
  }

  // ── 增强生命周期（供 AppControl / CLI 使用） ──────────

  /**
   * 安装配置并尝试连接。启动失败时保留配置，返回 installed=true + 实际状态。
   */
  async installServer(config: import('@ant-chat/shared').AddMcpConfigSchema): Promise<{ serverName: string, status: string, error?: string }> {
    const saved = this.core.data.mcpSettingsRepository.addMcpConfig(config)
    this.core.events.emit('mcp:changed', { serverName: saved.serverName })
    try {
      await this.clientHub.connectToServer(saved.serverName, saved)
      return { serverName: saved.serverName, status: 'connected' }
    }
    catch (err) {
      return {
        serverName: saved.serverName,
        status: 'disconnected',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * 编辑配置，运行中自动重连；已停止则只更新配置。
   */
  async editServer(config: import('@ant-chat/shared').McpConfigSchema): Promise<{ serverName: string, status: string, error?: string }> {
    const saved = this.core.data.mcpSettingsRepository.updateMcpConfig(config)
    this.core.events.emit('mcp:changed', { serverName: saved.serverName })

    const existing = this.clientHub.connections.find(c => c.server.name === saved.serverName)
    if (existing) {
      try {
        await this.clientHub.deleteConnection(saved.serverName)
        await this.clientHub.connectToServer(saved.serverName, saved)
        return { serverName: saved.serverName, status: 'connected' }
      }
      catch (err) {
        return {
          serverName: saved.serverName,
          status: 'disconnected',
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
    return { serverName: saved.serverName, status: 'disconnected' }
  }

  /**
   * 删除配置，运行中先断开再删。
   */
  async deleteServer(serverName: string): Promise<void> {
    await this.clientHub.deleteConnection(serverName).catch(() => {})
    this.core.data.mcpSettingsRepository.deleteMcpConfig(serverName)
    this.core.events.emit('mcp:changed', { serverName })
  }

  /**
   * 按名称启动（从持久化配置读取连接）。
   */
  async startServer(serverName: string): Promise<{ status: string, error?: string }> {
    const config = this.core.data.mcpSettingsRepository.getMcpConfigByServerName(serverName)
    if (!config)
      throw new Error(`MCP server not found: ${serverName}`)
    await this.clientHub.connectToServer(serverName, config)
    return { status: 'connected' }
  }

  /**
   * 按名称停止（幂等）。
   */
  async stopServer(serverName: string): Promise<{ status: string }> {
    await this.clientHub.deleteConnection(serverName).catch(() => {})
    return { status: 'disconnected' }
  }
}
