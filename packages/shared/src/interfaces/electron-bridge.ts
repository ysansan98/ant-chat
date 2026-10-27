/**
 * preload 实际暴露给渲染进程的 Electron bridge。
 *
 * 只声明已开放的能力，避免渲染层类型继续引用 `@electron-toolkit/preload`
 * 的完整 `electronAPI` 而误以为可以调用任意 IPC channel。
 */
export interface DesktopIpcListener {
  (event: unknown, ...args: unknown[]): void
}

export interface DesktopIpcRenderer {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: DesktopIpcListener) => void
  removeListener: (channel: string, listener: DesktopIpcListener) => void
}

export interface DesktopElectronApi {
  process: {
    platform: string
  }
  ipcRenderer: DesktopIpcRenderer
}
