import type { AddMcpConfigSchema, IpcResponse, McpConfigSchema, McpServer, McpTool, McpToolCallResponse, TextResult, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'
import { sendToRenderer } from '@main/utils/ipc-events'
import { logger } from '@main/utils/logger'
import { Notification } from '@main/utils/notification'
import { getMainWindow } from '@main/windows/window'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class McpIpcService extends IpcService {
  static readonly groupName = 'mcp'

  @IpcMethod()
  async getConfigs(): Promise<IpcResponse<McpConfigSchema[]>> {
    try {
      const data = getAgentRuntimeEnvironment().appDataServices.mcpSettingsRepository.getMcpConfigs()
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取MCP配置失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getConfigByServerName(serverName: string): Promise<IpcResponse<McpConfigSchema>> {
    try {
      const data = getAgentRuntimeEnvironment().appDataServices.mcpSettingsRepository.getMcpConfigByServerName(serverName)
      if (!data) {
        throw new Error(`MCP server not found: ${serverName}`)
      }
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取MCP配置详情失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addConfig(config: AddMcpConfigSchema): Promise<IpcResponse<McpConfigSchema>> {
    try {
      const data = getAgentRuntimeEnvironment().appDataServices.mcpSettingsRepository.addMcpConfig(config)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('添加MCP配置失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async updateConfig(config: UpdateMcpConfigSchema): Promise<IpcResponse<McpConfigSchema>> {
    try {
      const data = getAgentRuntimeEnvironment().appDataServices.mcpSettingsRepository.updateMcpConfig(config)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('更新MCP配置失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteConfig(serverName: string): Promise<IpcResponse<null>> {
    try {
      getAgentRuntimeEnvironment().appDataServices.mcpSettingsRepository.deleteMcpConfig(serverName)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除MCP配置失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getConnections(): Promise<IpcResponse<Pick<McpServer, 'name' | 'config' | 'tools' | 'status'>[]>> {
    const result: Pick<McpServer, 'name' | 'config' | 'tools' | 'status'>[] = getAgentRuntimeEnvironment().mcpClientHub.connections.map((item) => {
      const { server } = item
      const { name, config, tools = [], status } = server

      return { name, config, tools, status }
    })

    return createIpcResponse(true, result)
  }

  @IpcMethod()
  async getAllAvailableToolsList(): Promise<IpcResponse<McpTool[]>> {
    const data = getAgentRuntimeEnvironment().mcpClientHub.getAllAvailableToolsList() as McpTool[]
    return createIpcResponse(true, data)
  }

  @IpcMethod()
  async callTool(serverName: string, toolName: string, toolArguments?: Record<string, unknown>): Promise<IpcResponse<McpToolCallResponse>> {
    const data = await getAgentRuntimeEnvironment().mcpClientHub.callTool(serverName, toolName, toolArguments)

    const content = (data.content || [])
      .filter(item => item.type === 'text')
      .map(item => ({ type: 'text', text: item.text })) as TextResult[]

    return createIpcResponse(true, { content, isError: data.isError })
  }

  @IpcMethod()
  async connectMcpServer(name: string, mcpConfig: McpConfigSchema): Promise<IpcResponse<null>> {
    let ok = false
    let msg = ''
    let status: 'connected' | 'disconnected' = 'connected'
    const mainWindow = getMainWindow()
    try {
      ok = await getAgentRuntimeEnvironment().mcpClientHub.connectToServer(name, mcpConfig)
    }
    catch (e) {
      logger.error('connect mcp server error', e)
      status = 'disconnected'
      if (mainWindow) {
        msg = (e as Error).message
        Notification.error({ message: `${name} connect fail.`, description: msg })
      }
    }

    if (mainWindow) {
      sendToRenderer(mainWindow.webContents, 'mcp:McpServerStatusChanged', name, status)
    }
    return createIpcResponse(ok, null, msg)
  }

  @IpcMethod()
  async disconnectMcpServer(name: string): Promise<IpcResponse<null>> {
    const ok = await getAgentRuntimeEnvironment().mcpClientHub.deleteConnection(name)
    return createIpcResponse(ok, null)
  }

  @IpcMethod()
  async reconnectMcpServer(name: string, mcpConfig: McpConfigSchema): Promise<IpcResponse<null>> {
    let ok = true
    let msg = ''
    try {
      await getAgentRuntimeEnvironment().mcpClientHub.deleteConnection(name)
      await getAgentRuntimeEnvironment().mcpClientHub.connectToServer(name, mcpConfig)
    }
    catch (e) {
      ok = false
      msg = (e as Error).message
    }

    return createIpcResponse(ok, null, msg)
  }

  @IpcMethod()
  async fetchMcpServerTools(name: string): Promise<IpcResponse<McpTool[]>> {
    const data = await getAgentRuntimeEnvironment().mcpClientHub.fetchToolsList(name) as McpTool[]
    return createIpcResponse(true, data)
  }

  @IpcMethod()
  async mcpToggle(isEnable: boolean, mcpConfigs?: McpConfigSchema[]): Promise<IpcResponse<null>> {
    if (isEnable) {
      if (!mcpConfigs) {
        return createIpcResponse(false, null, 'needs mcpConfig')
      }
      getAgentRuntimeEnvironment().mcpClientHub.initializeMcpServers(mcpConfigs)
    }
    else {
      getAgentRuntimeEnvironment().mcpClientHub.connections.map(item => item.server.name).forEach((name) => {
        getAgentRuntimeEnvironment().mcpClientHub.deleteConnection(name)
      })
    }
    return createIpcResponse(true, null)
  }
}
