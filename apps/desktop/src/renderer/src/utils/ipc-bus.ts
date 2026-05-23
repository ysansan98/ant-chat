import type { IpcPaginatedResponse, IpcResponse } from '@ant-chat/shared'
import type { IpcServices } from '@main/bridge'
import { createIpcProxy } from 'electron-ipc-decorator/client'
import { pick } from 'lodash-es'

export const ipc = createIpcProxy<IpcServices>(window.electron.ipcRenderer)!
export const ipcRenderer = window.electron.ipcRenderer

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
