import type { electronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electronAPI: typeof electronAPI
    electron: typeof electronAPI
  }
}

export {}
