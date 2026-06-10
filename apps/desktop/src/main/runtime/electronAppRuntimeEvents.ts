import type { AppRuntime } from '@ant-chat/app-runtime'
import { sendToRenderer } from '@main/utils/ipc-events'
import { getSettingsWindow } from '@main/windows/settings-window'
import { getMainWindow } from '@main/windows/window'

export function attachAppRuntimeEvents(runtime: AppRuntime): void {
  function ipc(channel: string, ...data: unknown[]) {
    const win = getMainWindow()
    if (!win)
      return
    sendToRenderer(win.webContents, channel, ...data)
  }

  runtime.events.on('message.updated', ({ message }) => ipc('message:updated', message))
  runtime.events.on('agent.task.updated', ({ task }) => ipc('agent:state-updated', { task }))
  runtime.events.on('agent.approval.required', event => ipc('agent:approval-required', event))
  runtime.events.on('workspace.changed', event => ipc('workspace:changed', event))
  runtime.events.on('provider.changed', () => ipc('provider:changed'))
  runtime.events.on('mcp.connection.changed', event =>
    ipc('mcp:McpServerStatusChanged', event.serverName, event.status))
  runtime.events.on('settings.changed', (event) => {
    ipc('settings:updated', event)
    const settingsWindow = getSettingsWindow()
    if (settingsWindow && !settingsWindow.isDestroyed())
      settingsWindow.webContents.send('settings:updated', event)
  })
}
