import type { AppRuntime } from '@ant-chat/app-runtime'
import type { IpcRendererEvent } from '@ant-chat/shared'
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

  runtime.events.on('conversation:updated', event => ipc('conversation:updated', event))
  runtime.events.on('message:updated', event => ipc('message:updated', event))
  runtime.events.on('agent:task-updated', event => ipc('agent:task-updated', event))
  runtime.events.on('agent:approval-required', event => ipc('agent:approval-required', event))
  runtime.events.on('workspace:changed', event => ipc('workspace:changed', event))
  runtime.events.on('provider:changed', event => ipc('provider:changed', event))
  runtime.events.on('mcp:status-changed', event => ipc('mcp:status-changed', event))
  runtime.events.on('settings:updated', (event) => {
    ipc('settings:updated', event)
    const settingsWindow = getSettingsWindow()
    if (settingsWindow && !settingsWindow.isDestroyed())
      settingsWindow.webContents.send('settings:updated', event)
  })
}
