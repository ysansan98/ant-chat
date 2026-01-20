import type { UpdateConfig, UpdateInfo, UpdateStatus } from '@ant-chat/shared'
import { emitter, unwrapIpcResponse } from '@/utils/ipc-bus'

export interface UpdateAPI {
  getCurrentVersion: () => Promise<string>
  checkForUpdates: () => Promise<UpdateInfo | null>
  getUpdateConfig: () => Promise<UpdateConfig>
  setUpdateConfig: (config: UpdateConfig) => Promise<UpdateConfig>
  downloadUpdate: () => Promise<null>
  getUpdateStatus: () => Promise<UpdateStatus>
  quitAndInstall: () => void
  cancelDownload: () => void
  checkForUpdatesManual: () => void
}

export const updateApi: UpdateAPI = {
  getCurrentVersion: async () => {
    const response = await emitter.invoke('update:get-current-version')
    return unwrapIpcResponse(response)
  },

  checkForUpdates: async () => {
    const response = await emitter.invoke('update:check-for-updates-manual')
    return unwrapIpcResponse(response)
  },

  getUpdateConfig: async () => {
    const response = await emitter.invoke('update:get-update-config')
    return unwrapIpcResponse(response)
  },

  setUpdateConfig: async (config: UpdateConfig) => {
    const response = await emitter.invoke('update:set-update-config', config)
    return unwrapIpcResponse(response)
  },

  downloadUpdate: async () => {
    const response = await emitter.invoke('update:download-update')
    return unwrapIpcResponse(response)
  },

  getUpdateStatus: async () => {
    const response = await emitter.invoke('update:get-update-status')
    return unwrapIpcResponse(response)
  },

  quitAndInstall: () => {
    emitter.send('update:quit-and-install')
  },

  cancelDownload: () => {
    emitter.send('update:cancel-download')
  },

  checkForUpdatesManual: () => {
    emitter.send('update:check-for-updates')
  },
}
