import type { AgentBrowserPaths } from '../agentBrowser'
import type { AppDataContext, AppDataDatabase } from '../data'
import type { RuntimeEventBus } from '../events'
import type { AppRuntimePaths } from '../paths'
import type { KeychainSecretStore } from '../secretStore'
import type { SystemLogger } from '../systemLogger'
import type { CreateAppRuntimeOptions } from './types'
import { createAgentBrowserPaths } from '../agentBrowser'
import { createAppDataContext } from '../data'
import { openAppDataDatabase } from '../database'
import { RuntimeEventBus as RuntimeEventBusImpl } from '../events'
import { createAppRuntimePaths } from '../paths'
import { getAppRuntimeLogger } from '../runtimeLogger'
import { KeychainSecretStore as KeychainSecretStoreImpl } from '../secretStore'

export interface RuntimeDatabase extends AppDataDatabase {
  close: () => void
}

export interface RuntimeCore {
  browserPaths: AgentBrowserPaths
  data: AppDataContext
  db: RuntimeDatabase
  events: RuntimeEventBus
  logger: SystemLogger
  paths: AppRuntimePaths
  secretStore: KeychainSecretStore
  bashEnvironment?: Record<string, string>
}

export function createRuntimeCore(options: CreateAppRuntimeOptions): RuntimeCore {
  const paths = createAppRuntimePaths(options.appDataRoot)
  const logger = options.logger ?? getAppRuntimeLogger(options.appDataRoot, options.loggerOptions)
  const db = openAppDataDatabase(paths.databaseFile)
  const data = createAppDataContext({
    db,
    settingsFilePath: paths.settingsFile,
    mcpSettingsFilePath: paths.mcpSettingsFile,
    memoryRootPath: paths.memoryRoot,
    workspaceSettingsFilePath: paths.workspaceSettingsFile,
    attachmentsRootPath: paths.attachmentsRoot,
    permissionsFilePath: paths.permissionsFile,
  })

  return {
    browserPaths: createAgentBrowserPaths(),
    data,
    db,
    events: new RuntimeEventBusImpl(),
    logger,
    paths,
    secretStore: new KeychainSecretStoreImpl(),
    bashEnvironment: options.bashEnvironment,
  }
}
