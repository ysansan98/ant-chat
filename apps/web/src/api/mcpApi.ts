import type {
  AddMcpConfigSchema,
  McpConfigSchema,
  McpConnection,
  McpServerEditPatch,
  McpServerLifecycleResult,
  McpServerTestResult,
  McpTool,
} from '@ant-chat/shared'
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

export function getMcpConfigs(): Promise<McpConfigSchema[]> {
  return getAppRpcClient().call('mcp.getConfigs', undefined)
}

export function getMcpConfigByServerName(serverName: string): Promise<McpConfigSchema> {
  return getAppRpcClient().call('mcp.getConfigByServerName', { serverName })
}

export function installMcpServer(config: AddMcpConfigSchema): Promise<McpServerLifecycleResult> {
  return getAppRpcClient().call('mcp.installServer', { config })
}

export function editMcpServer(serverName: string, updates: McpServerEditPatch): Promise<McpServerLifecycleResult> {
  return getAppRpcClient().call('mcp.editServer', { serverName, updates })
}

export function deleteMcpServer(serverName: string): Promise<McpServerLifecycleResult> {
  return getAppRpcClient().call('mcp.deleteServer', { serverName })
}

export function startMcpServer(serverName: string): Promise<McpServerLifecycleResult> {
  return getAppRpcClient().call('mcp.startServer', { serverName })
}

export function stopMcpServer(serverName: string): Promise<McpServerLifecycleResult> {
  return getAppRpcClient().call('mcp.stopServer', { serverName })
}

export function testMcpServer(config: AddMcpConfigSchema): Promise<McpServerTestResult> {
  return getAppRpcClient().call('mcp.testServer', { config })
}

export function getAllAvailableToolsList(): Promise<McpTool[]> {
  return getAppRpcClient().call('mcp.getAllAvailableToolsList', undefined)
}
