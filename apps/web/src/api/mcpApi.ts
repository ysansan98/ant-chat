import type { AddMcpConfigSchema, McpConfigSchema, McpConnection, McpTool, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

export async function getMcpServers(): Promise<McpConnection[]> {
  try {
    return (await getAppTransport()).mcp.getConnections()
  }
  catch (e) {
    const error = e as Error
    console.warn('getMcpServers fail: ', error.message)
    return []
  }
}

export async function getMcpConfigs(): Promise<McpConfigSchema[]> {
  return (await getAppTransport()).mcp.getConfigs()
}

export async function getMcpConfigByServerName(serverName: string): Promise<McpConfigSchema> {
  return (await getAppTransport()).mcp.getConfigByServerName(serverName)
}

export async function addMcpConfig(config: AddMcpConfigSchema): Promise<McpConfigSchema> {
  return (await getAppTransport()).mcp.addConfig(config)
}

export async function updateMcpConfig(config: UpdateMcpConfigSchema): Promise<McpConfigSchema> {
  return (await getAppTransport()).mcp.updateConfig(config)
}

export async function deleteMcpConfig(serverName: string): Promise<null> {
  return (await getAppTransport()).mcp.deleteConfig(serverName)
}

export async function getAllAvailableToolsList(): Promise<McpTool[]> {
  return (await getAppTransport()).mcp.getAllAvailableToolsList()
}

export async function connectMcpServer(config: McpConfigSchema): Promise<[boolean, string]> {
  const { serverName } = config

  try {
    await (await getAppTransport()).mcp.connectMcpServer(serverName, config)
    return [true, '']
  }
  catch (error) {
    return [false, (error as Error).message]
  }
}

export async function disconnectMcpServer(name: string): Promise<boolean> {
  await (await getAppTransport()).mcp.disconnectMcpServer(name)
  return true
}

export async function reconnectMcpServer(config: McpConfigSchema): Promise<[boolean, string]> {
  const { serverName } = config

  try {
    await (await getAppTransport()).mcp.reconnectMcpServer(serverName, config)
    return [true, '']
  }
  catch (error) {
    return [false, (error as Error).message]
  }
}

export async function fetchMcpServerTools(name: string): Promise<McpTool[]> {
  return (await getAppTransport()).mcp.fetchMcpServerTools(name)
}
