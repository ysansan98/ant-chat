import type { BrowserIdentityStatus, BrowserProfileSourceView } from '@ant-chat/shared'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'
import { getAppRpcClient, getAppRuntimeCapabilities } from './transports/appRpc'

async function getStatus(): Promise<BrowserIdentityStatus> {
  return getAppRpcClient().call('browserProfiles.getStatus', undefined)
}

async function listSources(): Promise<BrowserProfileSourceView[]> {
  return getAppRpcClient().call('browserProfiles.listSources', undefined)
}

async function importSource(sourceId?: string): Promise<BrowserIdentityStatus> {
  return getAppRpcClient().call('browserProfiles.import', { sourceId })
}

async function clear(): Promise<null> {
  return getAppRpcClient().call('browserProfiles.clear', undefined)
}

async function importFromDirectory(): Promise<BrowserIdentityStatus | null> {
  if (!getAppRuntimeCapabilities().nativeFilePicker)
    return null
  return unwrapIpcResponse(await ipc.browserProfiles.importFromDirectory())
}

export const browserProfilesApi = {
  getStatus,
  listSources,
  importSource,
  clear,
  importFromDirectory,
}
