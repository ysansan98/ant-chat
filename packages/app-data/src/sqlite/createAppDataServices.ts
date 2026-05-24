import type { AppDataDatabase } from './types'
import { FileSettingsRepository } from '../file'
import { ConversationService, MessageService, SettingsService } from '../services'
import { SqliteConversationRepository, SqliteMessageRepository } from './repositories'

export interface CreateAppDataServicesOptions {
  db: AppDataDatabase
  settingsFilePath: string
}

export function createAppDataServices(options: CreateAppDataServicesOptions) {
  const { db, settingsFilePath } = options

  return {
    conversationService: new ConversationService(new SqliteConversationRepository(db)),
    messageService: new MessageService(new SqliteMessageRepository(db)),
    settingsService: new SettingsService(new FileSettingsRepository({
      filePath: settingsFilePath,
    })),
  }
}
