import type { GeneralSettingsState } from '@ant-chat/shared'
import type { AppDataDatabase } from './types'
import { eq } from 'drizzle-orm'
import { FileSettingsRepository } from '../file'
import { ConversationService, MessageService, SettingsService } from '../services'
import { SqliteConversationRepository, SqliteMessageRepository, SqliteSettingsRepository } from './repositories'
import { appSettingsTable } from './schema'

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
      initialSettings: readLegacySqliteSettings(db),
    })),
  }
}

function readLegacySqliteSettings(db: AppDataDatabase): GeneralSettingsState | undefined {
  const repository = new SqliteSettingsRepository(db)
  const row = db.select().from(appSettingsTable).where(eq(appSettingsTable.key, 'general')).get()
  return row ? repository.parseStoredSettings(row.value) : undefined
}
