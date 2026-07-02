import type { AppRuntime } from '@ant-chat/backend'
import type { IpcRendererEvent } from '@ant-chat/shared'
import { APP_RENDERER_EVENT_NAMES } from '@ant-chat/shared'
import { sendToRenderer } from '@main/utils/ipc-events'
import { getSettingsWindow } from '@main/windows/settings-window'
import { getMainWindow } from '@main/windows/window'

export function attachAppRuntimeEvents(runtime: AppRuntime): void {
  function ipc<T extends keyof IpcRendererEvent & string>(channel: T, payload: IpcRendererEvent[T]) {
    const win = getMainWindow()
    if (!win)
      return
    sendToRenderer(win.webContents, channel, payload)
  }

  for (const channel of APP_RENDERER_EVENT_NAMES) {
    runtime.events.on(channel, (event) => {
      ipc(channel, event)

      if (channel === 'settings:updated') {
        const settingsWindow = getSettingsWindow()
        if (settingsWindow && !settingsWindow.isDestroyed())
          settingsWindow.webContents.send(channel, event)
      }
    })
  }
}
