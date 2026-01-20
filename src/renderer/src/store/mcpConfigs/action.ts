import type { McpConfigSchema, McpServerStatus } from '@ant-chat/shared'
import { produce } from 'immer'
import { dbApi } from '@/api/dbApi'
import { connectMcpServer, disconnectMcpServer } from '@/api/mcpApi'
import { useMcpConfigsStore } from './store'

export async function initializeMcpConfigs() {
  const list = await dbApi.getMcpConfigs()

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    const length = draft.mcpConfigs.length
    draft.mcpConfigs.splice(0, length, ...list)
  }))
}

export async function addMcpConfigAction(config: McpConfigSchema) {
  const data = await dbApi.addMcpConfig(config)

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    draft.mcpConfigs.push(data)
  }))

  return data
}

export async function upadteMcpConfigAction(config: McpConfigSchema) {
  const newConfig = await dbApi.updateMcpConfig(config)

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    const index = draft.mcpConfigs.findIndex(item => item.serverName === config.serverName)
    if (index > -1) {
      draft.mcpConfigs[index] = newConfig
    }
  }))
}

export async function deleteMcpConfigAction(name: string) {
  await dbApi.deleteMcpConfig(name)

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    draft.mcpConfigs = draft.mcpConfigs.filter(item => item.serverName !== name)
  }))
}

export async function connectMcpServerAction(name: string) {
  const config = await dbApi.getMcpConfigByServerName(name)

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    draft.mcpServerRuningStatusMap[name] = 'connecting'
  }))

  await connectMcpServer(config)
}

export async function disconnectMcpServerAction(name: string) {
  const ok = await disconnectMcpServer(name)

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    delete draft.mcpServerRuningStatusMap[name]
  }))
  return ok
}

export async function reconnectMcpServerAction(name: string) {
  await dbApi.getMcpConfigByServerName(name)

  await disconnectMcpServerAction(name)
  await connectMcpServerAction(name)
}

export async function onMcpServerStatusChanged(_: Electron.IpcRendererEvent, name: string, status: McpServerStatus) {
  console.log('onMcpServerStatusChanged => ', name, status)
  try {
    await dbApi.getMcpConfigByServerName(name)
  }
  catch {
    return
  }

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    if (status === 'disconnected') {
      delete draft.mcpServerRuningStatusMap[name]
    }
    else {
      draft.mcpServerRuningStatusMap[name] = status
    }
  }))
}
