import type { AppTransport } from '@ant-chat/shared'

let cachedTransport: AppTransport | null = null

export async function getAppTransport(): Promise<AppTransport> {
  if (cachedTransport) {
    return cachedTransport
  }

  if (globalThis.window?.electron?.ipcRenderer) {
    const { createElectronIpcTransport } = await import('./electronIpcTransport')
    cachedTransport = createElectronIpcTransport()
    return cachedTransport
  }

  const { createLocalWebTransport } = await import('./localWebTransport')
  cachedTransport = createLocalWebTransport()
  return cachedTransport
}
