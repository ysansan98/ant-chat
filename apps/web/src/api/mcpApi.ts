import type { AddMcpConfigSchema, McpConfigSchema, McpConnection, McpTool, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export async function getMcpServers(): Promise<McpConnection[]> {
  try {
    return getAppRpcClient().call('mcp.getConnections', undefined)
  }
  catch (e) {
    const error = e as Error
    console.warn('getMcpServers fail: ', error.message)
    return []
  }
}

export async function getMcpConfigs(): Promise<McpConfigSchema[]> {
  return getAppRpcClient().call('mcp.getConfigs', undefined)
}

export async function getMcpConfigByServerName(serverName: string): Promise<McpConfigSchema> {
  return getAppRpcClient().call('mcp.getConfigByServerName', { serverName })
}

export async function addMcpConfig(config: AddMcpConfigSchema): Promise<McpConfigSchema> {
  return getAppRpcClient().call('mcp.addConfig', { config })
}

export async function updateMcpConfig(config: UpdateMcpConfigSchema): Promise<McpConfigSchema> {
  return getAppRpcClient().call('mcp.updateConfig', { config })
}

export async function deleteMcpConfig(serverName: string): Promise<null> {
  return getAppRpcClient().call('mcp.deleteConfig', { serverName })
}

export async function getAllAvailableToolsList(): Promise<McpTool[]> {
  return getAppRpcClient().call('mcp.getAllAvailableToolsList', undefined)
}

export async function connectMcpServer(config: McpConfigSchema): Promise<[boolean, string]> {
  const { serverName } = config

  try {
    await getAppRpcClient().call('mcp.connectMcpServer', { name: serverName, config })
    return [true, '']
  }
  catch (error) {
    return [false, (error as Error).message]
  }
}

export async function disconnectMcpServer(name: string): Promise<boolean> {
  await getAppRpcClient().call('mcp.disconnectMcpServer', { name })
  return true
}

export async function reconnectMcpServer(config: McpConfigSchema): Promise<[boolean, string]> {
  const { serverName } = config

  try {
    await getAppRpcClient().call('mcp.reconnectMcpServer', { name: serverName, config })
    return [true, '']
  }
  catch (error) {
    return [false, (error as Error).message]
  }
}

export async function fetchMcpServerTools(name: string): Promise<McpTool[]> {
  return getAppRpcClient().call('mcp.fetchMcpServerTools', { name })
}
