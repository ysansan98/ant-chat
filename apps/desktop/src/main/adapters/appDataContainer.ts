import type { AppDataDatabase, ConversationService, MessageService, SettingsService } from '@ant-chat/app-data'
import path from 'node:path'
import { createAppDataServices } from '@ant-chat/app-data'
import { getDb } from '@main/db/db'
import { APP_NAME } from '@main/utils/constants'
import { getAppHand } from '@main/utils/util'

let appDataServices: {
  conversationService: ConversationService
  messageService: MessageService
  settingsService: SettingsService
} | null = null

export function getAppDataServices() {
  if (!appDataServices) {
    appDataServices = createAppDataServices({
      db: getDb() as AppDataDatabase,
      settingsFilePath: path.join(getAppHand(), APP_NAME, 'settings.json'),
    })
  }

  return appDataServices
}
