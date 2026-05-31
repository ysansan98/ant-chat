import type { AppDataDatabase } from './types'
import { McpSettingsRepository, McpSettingsStore } from '../mcp'
import { AgentMemoryManager } from '../memory'
import { AppSettingsStore, createModelCatalog, GeneralSettingsRepository, ProviderSettingsRepository, ToolApprovalWhitelistRepository } from '../settings'
import { WorkspaceService } from '../workspace'
import { SqliteMessageSearchQuery } from './queries'
import { SqliteConversationRepository, SqliteMessageRepository } from './repositories'
import { initializeAppDataSchema } from './schema'

export interface CreateAppDataContextOptions {
  db: AppDataDatabase
  settingsFilePath: string
  mcpSettingsFilePath: string
  memoryRootPath: string
  workspaceSettingsFilePath: string
}

export function createAppDataContext(options: CreateAppDataContextOptions) {
  const { db, settingsFilePath, mcpSettingsFilePath, memoryRootPath, workspaceSettingsFilePath } = options
  initializeAppDataSchema(db)

  const appSettingsStore = new AppSettingsStore({ filePath: settingsFilePath, resetInvalidFile: true })
  const providerSettingsRepository = new ProviderSettingsRepository(appSettingsStore)

  return {
    conversationRepository: new SqliteConversationRepository(db),
    messageRepository: new SqliteMessageRepository(db),
    messageSearchQuery: new SqliteMessageSearchQuery(db),
    settingsRepository: new GeneralSettingsRepository({
      filePath: settingsFilePath,
      store: appSettingsStore,
    }),
    providerSettingsRepository,
    modelCatalog: createModelCatalog(providerSettingsRepository),
    memoryManager: new AgentMemoryManager(memoryRootPath),
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

export type AppDataContext = ReturnType<typeof createAppDataContext>
