declare module 'electron-ipc-decorator/client' {
  import type { electronAPI } from '@electron-toolkit/preload'
  import type { IpcRenderer } from 'electron'

  type PreloadIpcRenderer = typeof electronAPI['ipcRenderer']

  export function createIpcProxy<IpcServices extends Record<string, any>>(
    ipc: IpcRenderer | PreloadIpcRenderer | null,
  ): IpcServices | null
}
