import type { AddMcpConfigSchema, McpConfigSchema, McpConnection, McpTool, McpToolCall, McpToolCallResponse, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { uuid } from '@/utils'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'

export async function getMcpServers(): Promise<McpConnection[]> {
  try {
    return unwrapIpcResponse(await ipc.mcp.getConnections())
  }
  catch (e) {
    const error = e as Error
    console.warn('getMcpServers fail: ', error.message)
    return []
  }
}

export async function getMcpConfigs(): Promise<McpConfigSchema[]> {
  return unwrapIpcResponse(await ipc.mcp.getConfigs())
}

export async function getMcpConfigByServerName(serverName: string): Promise<McpConfigSchema> {
  return unwrapIpcResponse(await ipc.mcp.getConfigByServerName(serverName))
}

export async function addMcpConfig(config: AddMcpConfigSchema): Promise<McpConfigSchema> {
  return unwrapIpcResponse(await ipc.mcp.addConfig(config))
}

export async function updateMcpConfig(config: UpdateMcpConfigSchema): Promise<McpConfigSchema> {
  return unwrapIpcResponse(await ipc.mcp.updateConfig(config))
}

export async function deleteMcpConfig(serverName: string): Promise<null> {
  return unwrapIpcResponse(await ipc.mcp.deleteConfig(serverName))
}

export async function getAllAvailableToolsList(): Promise<McpTool[]> {
  return unwrapIpcResponse(await ipc.mcp.getAllAvailableToolsList())
}

type CreateMcpToolCallOptions = Partial<Omit<McpToolCall, 'serverName' | 'toolName' | 'args'>> & Pick<McpToolCall, 'serverName' | 'toolName' | 'args'>

export function createMcpToolCall(options: CreateMcpToolCallOptions): McpToolCall {
  if (!options.serverName || !options.toolName || !options.args) {
    throw new Error('serverName, toolName and arguments are required')
  }

  return {
    id: uuid('functioncall-'),
    ...options,
    executeState: 'await',
  }
}

export async function executeMcpToolCall(toolCall: McpToolCall): Promise<McpToolCallResponse> {
  const { serverName, toolName, args } = toolCall
  const resp = await ipc.mcp.callTool(serverName, toolName, args)
  if (resp.success) {
    return resp.data
  }
  throw new Error(resp.msg)
}

export async function connectMcpServer(config: McpConfigSchema): Promise<[boolean, string]> {
  const { serverName } = config

  const resp = await ipc.mcp.connectMcpServer(serverName, config)

  return [resp.success, resp.success ? '' : resp.msg]
}

export async function disconnectMcpServer(name: string): Promise<boolean> {
  const resp = await ipc.mcp.disconnectMcpServer(name)
  return resp.success
}

export async function reconnectMcpServer(config: McpConfigSchema): Promise<[boolean, string]> {
  const { serverName } = config

  const resp = await ipc.mcp.reconnectMcpServer(serverName, config)

  return [resp.success, resp.success ? '' : resp.msg]
}

export async function fetchMcpServerTools(name: string): Promise<McpTool[]> {
  const resp = await ipc.mcp.fetchMcpServerTools(name)
  if (resp.success) {
    return resp.data
  }

  console.error('fetchMcpServerTools fail', resp.msg)
  return []
}
