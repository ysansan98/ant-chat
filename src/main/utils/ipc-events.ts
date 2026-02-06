import type { IpcRendererEvent } from '@ant-chat/shared'
import type { WebContents } from 'electron'

export function sendToRenderer<T extends keyof IpcRendererEvent & string>(
  webContents: WebContents,
  channel: T,
  ...args: IpcRendererEvent[T]
) {
  webContents.send(channel, ...args)
}
