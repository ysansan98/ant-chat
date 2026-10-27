import type { DesktopElectronApi } from '@ant-chat/shared'

declare global {
  interface Window {
    electron: DesktopElectronApi
  }
}

export {}
