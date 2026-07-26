import type {
  AddMcpConfigSchema,
  McpServerEditPatch,
  McpServerLifecycleResult,
  McpServerStatus,
} from '@ant-chat/shared'
import { produce } from 'immer'
import {
  deleteMcpServer,
  editMcpServer,
  getMcpConfigByServerName,
  getMcpConfigs,
  installMcpServer,
  startMcpServer,
  stopMcpServer,
} from '@/api/mcpApi'
import { useMcpConfigsStore } from './store'

export async function initializeMcpConfigs(): Promise<void> {
  const list = await getMcpConfigs()

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    const length = draft.mcpConfigs.length
    draft.mcpConfigs.splice(0, length, ...list)
  }))
}

/** 刷新 MCP 配置（用于监听 mcp:changed 事件后刷新列表） */
export async function refreshMcpConfigs(): Promise<void> {
  await initializeMcpConfigs()
}

export async function installMcpServerAction(config: AddMcpConfigSchema): Promise<McpServerLifecycleResult> {
  return runLifecycleAction(() => installMcpServer(config), true)
}

export async function editMcpServerAction(serverName: string, updates: McpServerEditPatch): Promise<McpServerLifecycleResult> {
  return runLifecycleAction(() => editMcpServer(serverName, updates), true)
}

export async function deleteMcpServerAction(serverName: string, deletePermissionRules: boolean): Promise<McpServerLifecycleResult> {
  return runLifecycleAction(() => deleteMcpServer(serverName, deletePermissionRules), true)
}

export async function startMcpServerAction(serverName: string): Promise<McpServerLifecycleResult> {
  setStatus(serverName, 'connecting')
  return runLifecycleAction(() => startMcpServer(serverName))
}

export async function stopMcpServerAction(serverName: string): Promise<McpServerLifecycleResult> {
  return runLifecycleAction(() => stopMcpServer(serverName))
}

export async function onMcpServerStatusChanged(name: string, status: McpServerStatus): Promise<void> {
  try {
    await getMcpConfigByServerName(name)
  }
  catch {
    return
  }
  setStatus(name, status)
}

async function runLifecycleAction(
  action: () => Promise<McpServerLifecycleResult>,
  refreshConfigs = false,
): Promise<McpServerLifecycleResult> {
  const result = await action()
  setStatus(result.serverName, result.status)
  if (refreshConfigs)
    await initializeMcpConfigs()
  return result
}

function setStatus(name: string, status: McpServerStatus): void {
  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    if (status === 'disconnected')
      delete draft.mcpServerRuningStatusMap[name]
    else
      draft.mcpServerRuningStatusMap[name] = status
  }))
}
