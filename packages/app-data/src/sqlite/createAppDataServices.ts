import type { AppDataDatabase } from './types'
import { ConversationService, MessageService, SettingsService } from '../services'
import { SqliteConversationRepository, SqliteMessageRepository, SqliteSettingsRepository } from './repositories'

export function createAppDataServices(db: AppDataDatabase) {
  return {
    conversationService: new ConversationService(new SqliteConversationRepository(db)),
    messageService: new MessageService(new SqliteMessageRepository(db)),
    settingsService: new SettingsService(new SqliteSettingsRepository(db)),
  }
}
