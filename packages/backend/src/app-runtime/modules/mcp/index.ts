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
  getConfigs(_input: AppRpcInput<'mcp.getConfigs'>) {
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
    return this.core.data.mcpSettingsRepository.addMcpConfig(input.config)
  }

  @Method()
  updateConfig(input: AppRpcInput<'mcp.updateConfig'>) {
    return this.core.data.mcpSettingsRepository.updateMcpConfig(input.config)
  }

  @Method()
  deleteConfig(input: AppRpcInput<'mcp.deleteConfig'>) {
    this.core.data.mcpSettingsRepository.deleteMcpConfig(input.serverName)
    return null
  }

  @Method()
  getConnections(_input: AppRpcInput<'mcp.getConnections'>) {
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
}
