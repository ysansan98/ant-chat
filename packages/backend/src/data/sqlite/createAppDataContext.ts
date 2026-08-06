import type { AppDataDatabase } from './types'
import path from 'node:path'
import { McpSettingsRepository, McpSettingsStore } from '../mcp'
import { AgentMemoryManager, SqliteMemoryCatalog } from '../memory'
import { PermissionsFileStore } from '../permissions'
import { AppSettingsStore, createModelCatalog, GeneralSettingsRepository, ProviderSettingsRepository } from '../settings'
import { WorkspaceService } from '../workspace'
import { createAppDataMigrations, runSqliteMigrations } from './migrations'
import { SqliteMessageSearchQuery } from './queries'
import { SqliteAutomationRepository, SqliteChannelAccountRepository, SqliteChannelPairingRepository, SqliteChannelReceiptRepository, SqliteChannelSessionRepository, SqliteConversationRepository, SqliteMessageRepository } from './repositories'
import { SqliteMessageSearch } from './sqliteMessageSearch'

export interface CreateAppDataContextOptions {
  db: AppDataDatabase
  settingsFilePath: string
  mcpSettingsFilePath: string
  memoryRootPath: string
  /** 长期记忆正文根目录（memories/<workspace-key>/）。 */
  memoriesRootPath: string
  workspaceSettingsFilePath: string
  attachmentsRootPath?: string
  permissionsFilePath: string
}

export function createAppDataContext(options: CreateAppDataContextOptions) {
  const { db, settingsFilePath, mcpSettingsFilePath, memoryRootPath, memoriesRootPath, workspaceSettingsFilePath, permissionsFilePath } = options
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
    channelAccountRepository: new SqliteChannelAccountRepository(db),
    channelPairingRepository: new SqliteChannelPairingRepository(db),
    channelSessionRepository: new SqliteChannelSessionRepository(db),
    channelReceiptRepository: new SqliteChannelReceiptRepository(db),
    messageSearchQuery: new SqliteMessageSearchQuery(db),
    /** Agent 专用消息搜索后端（search_messages/get_thread/get_turn）。 */
    messageSearch: new SqliteMessageSearch(db),
    /** 人工批准的长期记忆目录。 */
    memoryCatalog: new SqliteMemoryCatalog(db, memoriesRootPath),
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
