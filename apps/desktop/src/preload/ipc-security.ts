import type { DesktopElectronApi, DesktopIpcListener, DesktopIpcRenderer } from '@ant-chat/shared'
import { APP_IPC_CHANNEL_NAMES, IPC_RENDERER_EVENT_NAMES } from '@ant-chat/shared'

const allowedInvokeChannels = new Set<string>(APP_IPC_CHANNEL_NAMES)
const allowedEventChannels = new Set<string>(IPC_RENDERER_EVENT_NAMES)

export interface RawIpcRenderer {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: DesktopIpcListener) => unknown
  removeListener: (channel: string, listener: DesktopIpcListener) => unknown
}

export function isAllowedInvokeChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && allowedInvokeChannels.has(channel)
}

export function isAllowedEventChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && allowedEventChannels.has(channel)
}

function rejectUnknownEventChannel(channel: unknown): never {
  throw new Error(`preload 拒绝未授权的 IPC 事件: ${String(channel)}`)
}

/**
 * 只向渲染进程暴露显式白名单内的 IPC 能力。
 * 白名单来自 `@ant-chat/shared`，与 `AppIpcServices` / 事件类型保持同步。
 */
export function createRestrictedIpcRenderer(raw: RawIpcRenderer): DesktopIpcRenderer {
  return {
    invoke(channel, ...args) {
      if (!isAllowedInvokeChannel(channel))
        return Promise.reject(new Error(`preload 拒绝未授权的 IPC 调用: ${String(channel)}`))
      return raw.invoke(channel, ...args)
    },
    on(channel, listener) {
      if (!isAllowedEventChannel(channel))
        rejectUnknownEventChannel(channel)
      if (typeof listener !== 'function')
        throw new TypeError(`preload IPC 事件监听器必须是函数: ${String(channel)}`)
      raw.on(channel, listener)
    },
    removeListener(channel, listener) {
      if (!isAllowedEventChannel(channel))
        rejectUnknownEventChannel(channel)
      if (typeof listener !== 'function')
        throw new TypeError(`preload IPC 事件监听器必须是函数: ${String(channel)}`)
      raw.removeListener(channel, listener)
    },
  }
}

export function createDesktopElectronApi(raw: RawIpcRenderer): DesktopElectronApi {
  return {
    process: {
      platform: process.platform,
    },
    ipcRenderer: createRestrictedIpcRenderer(raw),
  }
}
