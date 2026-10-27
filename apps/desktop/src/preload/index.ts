import { contextBridge, ipcRenderer } from 'electron'
import { createDesktopElectronApi } from './ipc-security'

console.log('process.contextIsolated => ', process.contextIsolated)

// 只暴露显式白名单内的能力，详见 ipc-security.ts。
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', createDesktopElectronApi(ipcRenderer))
  }
  catch (error) {
    console.error(error)
  }
}
