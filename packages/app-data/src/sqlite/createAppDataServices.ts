import type { AppDataDatabase } from './types'
import { FileSettingsRepository } from '../file'
import { McpSettingsRepository, McpSettingsStore } from '../mcp'
import { ConversationService, MessageService, SettingsService } from '../services'
import { AppSettingsStore, createModelSettingsResolver, ProviderSettingsRepository } from '../settings'
import { SqliteConversationRepository, SqliteMessageRepository } from './repositories'

export interface CreateAppDataServicesOptions {
  db: AppDataDatabase
  settingsFilePath: string
  mcpSettingsFilePath: string
}

export function createAppDataServices(options: CreateAppDataServicesOptions) {
  const { db, settingsFilePath, mcpSettingsFilePath } = options
  const appSettingsStore = new AppSettingsStore({ filePath: settingsFilePath, resetInvalidFile: true })
  const providerSettingsRepository = new ProviderSettingsRepository(appSettingsStore)

  return {
    conversationService: new ConversationService(new SqliteConversationRepository(db)),
    messageService: new MessageService(new SqliteMessageRepository(db)),
    settingsService: new SettingsService(new FileSettingsRepository({
      filePath: settingsFilePath,
      store: appSettingsStore,
    })),
    providerSettingsRepository,
    modelSettingsResolver: createModelSettingsResolver(providerSettingsRepository),
    mcpSettingsRepository: new McpSettingsRepository(new McpSettingsStore({
      filePath: mcpSettingsFilePath,
      resetInvalidFile: true,
    })),
  }
}
