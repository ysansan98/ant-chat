import type { AppDataDatabase } from './types'
import path from 'node:path'
import { McpSettingsRepository, McpSettingsStore } from '../mcp'
import { AgentMemoryManager } from '../memory'
import { AppSettingsStore, createModelCatalog, GeneralSettingsRepository, ProviderSettingsRepository, ToolApprovalWhitelistRepository } from '../settings'
import { WorkspaceService } from '../workspace'
import { migrateAddDurationMs, migrateMessageAttachments, rebuildMessagesTable } from './migrations/migrateAttachments'
import { SqliteMessageSearchQuery } from './queries'
import { SqliteConversationRepository, SqliteMessageRepository } from './repositories'
import { initializeAppDataSchema } from './schema'

export interface CreateAppDataContextOptions {
  db: AppDataDatabase
  settingsFilePath: string
  mcpSettingsFilePath: string
  memoryRootPath: string
  workspaceSettingsFilePath: string
  attachmentsRootPath?: string
}

export function createAppDataContext(options: CreateAppDataContextOptions) {
  const { db, settingsFilePath, mcpSettingsFilePath, memoryRootPath, workspaceSettingsFilePath } = options
  const attachmentsRootPath = options.attachmentsRootPath ?? path.join(path.dirname(settingsFilePath), 'attachments')
  initializeAppDataSchema(db)
  migrateAddDurationMs(db)
  migrateMessageAttachments(db, attachmentsRootPath)
  rebuildMessagesTable(db)

  const appSettingsStore = new AppSettingsStore({ filePath: settingsFilePath, resetInvalidFile: true })
  const providerSettingsRepository = new ProviderSettingsRepository(appSettingsStore)
  const messageRepository = new SqliteMessageRepository(db, { attachmentsRoot: attachmentsRootPath })
  const conversationRepository = new SqliteConversationRepository(db, {
    prepareConversationAttachmentCleanup: messageRepository.prepareConversationAttachmentCleanup.bind(messageRepository),
  })

  return {
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
    toolApprovalWhitelistRepository: new ToolApprovalWhitelistRepository(appSettingsStore),
    workspaceService: new WorkspaceService({
      filePath: workspaceSettingsFilePath,
      resetInvalidFile: true,
    }),
  }
}

export type AppDataContext = ReturnType<typeof createAppDataContext>
