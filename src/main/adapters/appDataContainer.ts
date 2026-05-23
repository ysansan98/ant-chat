import { ConversationService, MessageService, SettingsService } from '@ant-chat/app-data'
import { SqliteConversationRepository } from './sqliteConversationRepository.adapter'
import { SqliteMessageRepository } from './sqliteMessageRepository.adapter'
import { SqliteSettingsRepository } from './sqliteSettingsRepository.adapter'

let appDataServices: {
  conversationService: ConversationService
  messageService: MessageService
  settingsService: SettingsService
} | null = null

export function getAppDataServices() {
  if (!appDataServices) {
    appDataServices = {
      conversationService: new ConversationService(new SqliteConversationRepository()),
      messageService: new MessageService(new SqliteMessageRepository()),
      settingsService: new SettingsService(new SqliteSettingsRepository()),
    }
  }

  return appDataServices
}
