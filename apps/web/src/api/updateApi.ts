import type { UpdateConfig, UpdateInfo, UpdateStatus } from '@ant-chat/shared'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'

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
    return unwrapIpcResponse(await ipc.update.getCurrentVersion())
  },

  checkForUpdates: async () => {
    return unwrapIpcResponse(await ipc.update.checkForUpdatesManual())
  },

  getUpdateConfig: async () => {
    return unwrapIpcResponse(await ipc.update.getUpdateConfig())
  },

  setUpdateConfig: async (config: UpdateConfig) => {
    return unwrapIpcResponse(await ipc.update.setUpdateConfig(config))
  },

  downloadUpdate: async () => {
    return unwrapIpcResponse(await ipc.update.downloadUpdate())
  },

  getUpdateStatus: async () => {
    return unwrapIpcResponse(await ipc.update.getUpdateStatus())
  },

  quitAndInstall: () => {
    void ipc.update.quitAndInstall()
  },

  cancelDownload: () => {
    void ipc.update.cancelDownload()
  },

  checkForUpdatesManual: () => {
    void ipc.update.checkForUpdates()
  },
}
