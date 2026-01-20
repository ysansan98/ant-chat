import type { IpcEvents, IpcRendererEvent } from '@ant-chat/shared'
import { IpcEmitter } from '@electron-toolkit/typed-ipc/main'
import { LoggedIpcListener } from './logged-ipc-listener'

// 创建事件监听器和处理器实例
export const mainListener = new LoggedIpcListener<IpcEvents>()
export const mainEmitter = new IpcEmitter<IpcRendererEvent>()
