import type { AddMcpConfigSchema, IpcResponse, McpConfigSchema, McpServer, McpTool, McpToolCallResponse, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/runtime/appRuntime'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class McpIpcService extends IpcService {
  static readonly groupName = 'mcp'

  @IpcMethod()
  async getConfigs(): Promise<IpcResponse<McpConfigSchema[]>> {
    try {
      const data = getAppRuntime().mcp.getConfigs()
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
      const data = getAppRuntime().mcp.getConfig(serverName)
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
      const data = getAppRuntime().mcp.addConfig(config)
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
      const data = getAppRuntime().mcp.updateConfig(config)
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
      getAppRuntime().mcp.deleteConfig(serverName)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除MCP配置失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getConnections(): Promise<IpcResponse<Pick<McpServer, 'name' | 'config' | 'tools' | 'status'>[]>> {
    return createIpcResponse(true, getAppRuntime().mcp.getConnections())
  }

  @IpcMethod()
  async getAllAvailableToolsList(): Promise<IpcResponse<McpTool[]>> {
    const data = getAppRuntime().mcp.getAllTools()
    return createIpcResponse(true, data)
  }

  @IpcMethod()
  async callTool(serverName: string, toolName: string, toolArguments?: Record<string, unknown>): Promise<IpcResponse<McpToolCallResponse>> {
    return createIpcResponse(true, await getAppRuntime().mcp.callTool(serverName, toolName, toolArguments))
  }

  @IpcMethod()
  async connectMcpServer(name: string, mcpConfig: McpConfigSchema): Promise<IpcResponse<null>> {
    try {
      await getAppRuntime().mcp.connect(name, mcpConfig)
      return createIpcResponse(true, null)
    }
    catch (e) {
      logger.error('connect mcp server error', e)
      return createErrorIpcResponse(e as Error)
    }
  }

  @IpcMethod()
  async disconnectMcpServer(name: string): Promise<IpcResponse<null>> {
    await getAppRuntime().mcp.disconnect(name)
    return createIpcResponse(true, null)
  }

  @IpcMethod()
  async reconnectMcpServer(name: string, mcpConfig: McpConfigSchema): Promise<IpcResponse<null>> {
    let ok = true
    let msg = ''
    try {
      await getAppRuntime().mcp.reconnect(name, mcpConfig)
    }
    catch (e) {
      ok = false
      msg = (e as Error).message
    }

    return createIpcResponse(ok, null, msg)
  }

  @IpcMethod()
  async fetchMcpServerTools(name: string): Promise<IpcResponse<McpTool[]>> {
    const data = await getAppRuntime().mcp.fetchTools(name) as McpTool[]
    return createIpcResponse(true, data)
  }

  @IpcMethod()
  async mcpToggle(isEnable: boolean, mcpConfigs?: McpConfigSchema[]): Promise<IpcResponse<null>> {
    await getAppRuntime().mcp.setEnabled(isEnable, mcpConfigs)
    return createIpcResponse(true, null)
  }
}
