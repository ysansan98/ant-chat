import type { AppDataDatabase, ConversationService, MessageService, SettingsService } from '@ant-chat/app-data'
import path from 'node:path'
import { createAppDataServices } from '@ant-chat/app-data'
import { getDb } from '@main/db/db'
import { getAppDataRoot } from '@main/utils/appPaths'

let appDataServices: {
  conversationService: ConversationService
  messageService: MessageService
  settingsService: SettingsService
} | null = null

export function getAppDataServices() {
  if (!appDataServices) {
    appDataServices = createAppDataServices({
      db: getDb() as AppDataDatabase,
      settingsFilePath: path.join(getAppDataRoot(), 'settings.json'),
    })
  }

  return appDataServices
}
