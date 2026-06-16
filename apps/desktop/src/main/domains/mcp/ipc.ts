import type { AddMcpConfigSchema, IpcResponse, McpConfigSchema, McpServer, McpTool, McpToolCallResponse, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { createIpcResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { normalizeIpcError, withIpcResponse } from '@main/utils/ipc-response'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class McpIpcService extends IpcService {
  static readonly groupName = 'mcp'

  @IpcMethod()
  async getConfigs(): Promise<IpcResponse<McpConfigSchema[]>> {
    return withIpcResponse(() => getAppRuntime().mcp.getConfigs(), '获取 MCP 配置失败')
  }

  @IpcMethod()
  async getConfigByServerName(serverName: string): Promise<IpcResponse<McpConfigSchema>> {
    return withIpcResponse(() => getAppRuntime().mcp.getConfig(serverName), '获取 MCP 配置详情失败')
  }

  @IpcMethod()
  async addConfig(config: AddMcpConfigSchema): Promise<IpcResponse<McpConfigSchema>> {
    return withIpcResponse(() => getAppRuntime().mcp.addConfig(config), '添加 MCP 配置失败')
  }

  @IpcMethod()
  async updateConfig(config: UpdateMcpConfigSchema): Promise<IpcResponse<McpConfigSchema>> {
    return withIpcResponse(() => getAppRuntime().mcp.updateConfig(config), '更新 MCP 配置失败')
  }

  @IpcMethod()
  async deleteConfig(serverName: string): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().mcp.deleteConfig(serverName), '删除 MCP 配置失败')
  }

  @IpcMethod()
  async getConnections(): Promise<IpcResponse<Pick<McpServer, 'name' | 'config' | 'tools' | 'status'>[]>> {
    return withIpcResponse(() => getAppRuntime().mcp.getConnections(), '获取 MCP 连接列表失败')
  }

  @IpcMethod()
  async getAllAvailableToolsList(): Promise<IpcResponse<McpTool[]>> {
    return withIpcResponse(() => getAppRuntime().mcp.getAllTools(), '获取 MCP 工具列表失败')
  }

  @IpcMethod()
  async callTool(serverName: string, toolName: string, toolArguments?: Record<string, unknown>): Promise<IpcResponse<McpToolCallResponse>> {
    return withIpcResponse(() => getAppRuntime().mcp.callTool(serverName, toolName, toolArguments), '调用 MCP 工具失败')
  }

  @IpcMethod()
  async connectMcpServer(name: string, mcpConfig: McpConfigSchema): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().mcp.connect(name, mcpConfig), '连接 MCP 服务器失败')
  }

  @IpcMethod()
  async disconnectMcpServer(name: string): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().mcp.disconnect(name), '断开 MCP 服务器失败')
  }

  // reconnect 需要把失败信息塞进 msg 字段而非抛错，调用方据此展示重连失败原因，故不走 withIpcResponse。
  @IpcMethod()
  async reconnectMcpServer(name: string, mcpConfig: McpConfigSchema): Promise<IpcResponse<null>> {
    try {
      await getAppRuntime().mcp.reconnect(name, mcpConfig)
      return createIpcResponse(true, null)
    }
    catch (error) {
      const normalized = normalizeIpcError(error)
      logger.error('重连 MCP 服务器失败:', normalized)
      return createIpcResponse(false, null, normalized.message)
    }
  }

  @IpcMethod()
  async fetchMcpServerTools(name: string): Promise<IpcResponse<McpTool[]>> {
    return withIpcResponse(() => getAppRuntime().mcp.fetchTools(name) as Promise<McpTool[]>, '获取 MCP 服务器工具失败')
  }

  @IpcMethod()
  async mcpToggle(isEnable: boolean, mcpConfigs?: McpConfigSchema[]): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().mcp.setEnabled(isEnable, mcpConfigs), '切换 MCP 启用状态失败')
  }
}
