import type { IpcEvents, IpcPaginatedResponse, IpcRendererEvent, IpcResponse } from '@ant-chat/shared'
import { IpcEmitter, IpcListener } from '@electron-toolkit/typed-ipc/renderer'
import { pick } from 'lodash-es'

export const ipc = new IpcListener<IpcRendererEvent>()
export const emitter = new IpcEmitter<IpcEvents>()

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
