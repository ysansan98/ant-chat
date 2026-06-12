import type { McpConfigSchema, McpServerStatus } from '@ant-chat/shared'
import { produce } from 'immer'
import { addMcpConfig, connectMcpServer, deleteMcpConfig, disconnectMcpServer, getMcpConfigByServerName, getMcpConfigs, updateMcpConfig } from '@/api/mcpApi'
import { useMcpConfigsStore } from './store'

export async function initializeMcpConfigs() {
  const list = await getMcpConfigs()

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    const length = draft.mcpConfigs.length
    draft.mcpConfigs.splice(0, length, ...list)
  }))
}

export async function addMcpConfigAction(config: McpConfigSchema) {
  const data = await addMcpConfig(config)

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    draft.mcpConfigs.push(data)
  }))

  return data
}

export async function upadteMcpConfigAction(config: McpConfigSchema) {
  const newConfig = await updateMcpConfig(config)

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    const index = draft.mcpConfigs.findIndex(item => item.serverName === config.serverName)
    if (index > -1) {
      draft.mcpConfigs[index] = newConfig
    }
  }))
}

export async function deleteMcpConfigAction(name: string) {
  await deleteMcpConfig(name)

  useMcpConfigsStore.setState(state => produce(state, (draft) => {
    draft.mcpConfigs = draft.mcpConfigs.filter(item => item.serverName !== name)
  }))
}

export async function connectMcpServerAction(name: string) {
  const config = await getMcpConfigByServerName(name)

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
  await getMcpConfigByServerName(name)

  await disconnectMcpServerAction(name)
  await connectMcpServerAction(name)
}

export async function onMcpServerStatusChanged(name: string, status: McpServerStatus) {
  console.log('onMcpServerStatusChanged => ', name, status)
  try {
    await getMcpConfigByServerName(name)
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
