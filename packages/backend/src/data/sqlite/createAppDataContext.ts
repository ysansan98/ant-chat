import type { AppDataDatabase } from './types'
import path from 'node:path'
import { McpSettingsRepository, McpSettingsStore } from '../mcp'
import { AgentMemoryManager } from '../memory'
import { PermissionsFileStore } from '../permissions'
import { AppSettingsStore, createModelCatalog, GeneralSettingsRepository, ProviderSettingsRepository } from '../settings'
import { WorkspaceService } from '../workspace'
import { createAppDataMigrations, runSqliteMigrations } from './migrations'
import { SqliteMessageSearchQuery } from './queries'
import { SqliteAutomationRepository, SqliteConversationRepository, SqliteMessageRepository } from './repositories'

export interface CreateAppDataContextOptions {
  db: AppDataDatabase
  settingsFilePath: string
  mcpSettingsFilePath: string
  memoryRootPath: string
  workspaceSettingsFilePath: string
  attachmentsRootPath?: string
  permissionsFilePath: string
}

export function createAppDataContext(options: CreateAppDataContextOptions) {
  const { db, settingsFilePath, mcpSettingsFilePath, memoryRootPath, workspaceSettingsFilePath, permissionsFilePath } = options
  const attachmentsRootPath = options.attachmentsRootPath ?? path.join(path.dirname(settingsFilePath), 'attachments')
  runSqliteMigrations(db, createAppDataMigrations({ attachmentsRootPath }))

  const appSettingsStore = new AppSettingsStore({ filePath: settingsFilePath, resetInvalidFile: true })
  const providerSettingsRepository = new ProviderSettingsRepository(appSettingsStore)
  const messageRepository = new SqliteMessageRepository(db, { attachmentsRoot: attachmentsRootPath })
  const conversationRepository = new SqliteConversationRepository(db, {
    prepareConversationAttachmentCleanup: messageRepository.prepareConversationAttachmentCleanup.bind(messageRepository),
  })

  return {
    automationRepository: new SqliteAutomationRepository(db),
    conversationRepository,
    messageRepository,
    messageSearchQuery: new SqliteMessageSearchQuery(db),
    loadAttachmentData: messageRepository.loadAttachmentData.bind(messageRepository),
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
    permissionsFileStore: new PermissionsFileStore(permissionsFilePath),
    workspaceService: new WorkspaceService({
      filePath: workspaceSettingsFilePath,
      resetInvalidFile: true,
    }),
  }
}

export type AppDataContext = ReturnType<typeof createAppDataContext>
