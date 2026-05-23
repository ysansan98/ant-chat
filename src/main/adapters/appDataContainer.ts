import type { AppDataDatabase, ConversationService, MessageService, SettingsService } from '@ant-chat/app-data'
import { createAppDataServices } from '@ant-chat/app-data'
import { db } from '@main/db/db'

let appDataServices: {
  conversationService: ConversationService
  messageService: MessageService
  settingsService: SettingsService
} | null = null

export function getAppDataServices() {
  if (!appDataServices) {
    appDataServices = createAppDataServices(db as AppDataDatabase)
  }

  return appDataServices
}
