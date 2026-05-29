import type { AppDataDatabase } from './types'
import { McpSettingsRepository, McpSettingsStore } from '../mcp'
import { AgentProfileService } from '../profile'
import { ConversationService, MessageService, SettingsService } from '../services'
import { AppSettingsStore, createModelCatalog, GeneralSettingsRepository, ProviderSettingsRepository, ToolApprovalWhitelistRepository } from '../settings'
import { WorkspaceService } from '../workspace'
import { SqliteConversationRepository, SqliteMessageRepository } from './repositories'
import { initializeAppDataSchema } from './schema'
import { SqliteMessageSearchService } from './services'

export interface CreateAppDataServicesOptions {
  db: AppDataDatabase
  settingsFilePath: string
  mcpSettingsFilePath: string
  profileRootPath: string
  workspaceSettingsFilePath: string
}

export function createAppDataServices(options: CreateAppDataServicesOptions) {
  const { db, settingsFilePath, mcpSettingsFilePath, profileRootPath, workspaceSettingsFilePath } = options
  initializeAppDataSchema(db)

  const appSettingsStore = new AppSettingsStore({ filePath: settingsFilePath, resetInvalidFile: true })
  const providerSettingsRepository = new ProviderSettingsRepository(appSettingsStore)

  return {
    conversationService: new ConversationService(new SqliteConversationRepository(db)),
    messageService: new MessageService(new SqliteMessageRepository(db)),
    messageSearchService: new SqliteMessageSearchService(db),
    settingsService: new SettingsService(new GeneralSettingsRepository({
      filePath: settingsFilePath,
      store: appSettingsStore,
    })),
    providerSettingsRepository,
    modelCatalog: createModelCatalog(providerSettingsRepository),
    profileService: new AgentProfileService(profileRootPath),
    mcpSettingsRepository: new McpSettingsRepository(new McpSettingsStore({
      filePath: mcpSettingsFilePath,
      resetInvalidFile: true,
    })),
    toolApprovalWhitelistRepository: new ToolApprovalWhitelistRepository(appSettingsStore),
    workspaceService: new WorkspaceService({
      filePath: workspaceSettingsFilePath,
      resetInvalidFile: true,
    }),
  }
}

export type AppDataServices = ReturnType<typeof createAppDataServices>
