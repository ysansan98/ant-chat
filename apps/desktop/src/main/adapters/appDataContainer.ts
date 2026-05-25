import type { AppDataDatabase, ConversationService, McpSettingsRepository, MessageService, ProviderSettingsRepository, SettingsService } from '@ant-chat/app-data'
import type { IModelResolver } from '@ant-chat/shared'
import path from 'node:path'
import { createAppDataServices } from '@ant-chat/app-data'
import { getDb } from '@main/db/db'
import { getAppDataRoot } from '@main/utils/appPaths'

let appDataServices: {
  conversationService: ConversationService
  messageService: MessageService
  settingsService: SettingsService
  providerSettingsRepository: ProviderSettingsRepository
  modelSettingsResolver: IModelResolver
  mcpSettingsRepository: McpSettingsRepository
} | null = null

export function getAppDataServices() {
  if (!appDataServices) {
    appDataServices = createAppDataServices({
      db: getDb() as AppDataDatabase,
      settingsFilePath: path.join(getAppDataRoot(), 'settings.json'),
      mcpSettingsFilePath: path.join(getAppDataRoot(), 'mcp.json'),
    })
  }

  return appDataServices
}
