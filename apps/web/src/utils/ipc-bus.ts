import type { AppIpcServices, IpcPaginatedResponse, IpcResponse } from '@ant-chat/shared'
import { createIpcProxy } from 'electron-ipc-decorator/client'
import { pick } from 'lodash-es'
import { getAppEventBus } from '@/api/transports/appEventBus'

type IpcRendererBridge = Window['electron']['ipcRenderer']

function getElectronIpcRenderer(): IpcRendererBridge | null {
  return globalThis.window?.electron?.ipcRenderer ?? null
}

export function isElectronRuntime(): boolean {
  return Boolean(getElectronIpcRenderer())
}

/**
 * 是否运行在 Electron + macOS 环境。
 *
 * macOS 窗口左上角有系统红黄绿灯按钮，
 * 需要为它们预留空间。Web 端或无此需求的平台返回 false。
 */
export function isElectronMacOS(): boolean {
  if (!isElectronRuntime())
    return false
  return window.electron.process.platform === 'darwin'
}

export function getIpc(): AppIpcServices {
  const ipcRenderer = getElectronIpcRenderer()
  if (!ipcRenderer) {
    throw new Error('Electron IPC is not available in this runtime')
  }

  return createIpcProxy<AppIpcServices>(ipcRenderer)!
}

export const ipc = new Proxy({} as AppIpcServices, {
  get(_target, prop: keyof AppIpcServices) {
    return getIpc()[prop]
  },
})

export const ipcRenderer = new Proxy({} as IpcRendererBridge, {
  get(_target, prop: keyof IpcRendererBridge) {
    const renderer = getElectronIpcRenderer()
    if (!renderer) {
      if (prop === 'on' || prop === 'removeAllListeners' || prop === 'removeListener') {
        const bus = getAppEventBus()
        return bus[prop as keyof typeof bus].bind(bus)
      }
      throw new Error('Electron IPC renderer is not available in this runtime')
    }

    const value = renderer[prop]
    return typeof value === 'function' ? value.bind(renderer) : value
  },
})

export function unwrapIpcResponse<T>(resp: IpcResponse<T> | IpcPaginatedResponse<T>): T {
  if (!resp.success) {
    throw new Error(resp.msg)
  }

  return resp.data
}

export function unwrapIpcPaginatedResponse<T>(resp: IpcPaginatedResponse<T>): { data: T, total: number } {
  if (!resp.success) {
    throw new Error(resp.msg)
  }

  return pick(resp, ['data', 'total'])
}
