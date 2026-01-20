import type { BrowserWindow } from 'electron'
import { registerChatHandlers } from './chatHandlers'
import { registerCommonHandlers } from './commonHandlers'
import { registerDbHandlers } from './dbHandlers'
import { registerGeneralSettingsHandlers } from './generalSettingsHandlers'
import { registerProxyHandlers } from './proxyHandlers'
import { registerChatServiceEvent } from './registerChatServiceEvent'
import { registerUpdateHandlers } from './updateHandlers'

export function registerIpcEvents(mainWindow: BrowserWindow) {
  registerDbHandlers()
  registerCommonHandlers(mainWindow)
  registerChatHandlers()
  registerChatServiceEvent()
  registerGeneralSettingsHandlers()
  registerProxyHandlers()
  registerUpdateHandlers()
}
