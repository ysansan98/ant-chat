import type { CommandHost } from '../agent-core/native-tools/command/types'
import type { AgentBrowserPaths, BrowserIdentityPaths } from '../agentBrowser'
import type { AppDataContext, AppDataDatabase } from '../data'
import type { RuntimeEventBus } from '../events'
import type { AppRuntimePaths } from '../paths'
import type { KeychainSecretStore } from '../secretStore'
import type { SystemLogger } from '../systemLogger'
import type { CreateAppRuntimeOptions, OAuthCallbackHost } from './types'
import { resolveKeychainServiceName } from '@ant-chat/shared'
import { createAgentBrowserPaths, createBrowserIdentityPaths } from '../agentBrowser'
import { BrowserIdentityStore } from '../browser-identity/browserIdentityStore'
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
  browserIdentityPaths: BrowserIdentityPaths
  browserIdentity: BrowserIdentityStore
  /** 宿主注入的命令环境（PATH 等），供命令宿主与浏览器工具解析外部 CLI。 */
  commandEnvironment?: Readonly<Record<string, string>>
  data: AppDataContext
  db: RuntimeDatabase
  events: RuntimeEventBus
  logger: SystemLogger
  paths: AppRuntimePaths
  secretStore: KeychainSecretStore
  commandHost: CommandHost
  oauthCallbackHost?: OAuthCallbackHost
}

export function createRuntimeCore(options: CreateAppRuntimeOptions, commandHost: CommandHost): RuntimeCore {
  const paths = createAppRuntimePaths(options.appDataRoot)
  const logger = options.logger ?? getAppRuntimeLogger(options.appDataRoot, options.loggerOptions)
  const db = openAppDataDatabase(paths.databaseFile)
  const data = createAppDataContext({
    db,
    settingsFilePath: paths.settingsFile,
    mcpSettingsFilePath: paths.mcpSettingsFile,
    memoryRootPath: paths.memoryRoot,
    memoriesRootPath: paths.memoriesRoot,
    workspaceSettingsFilePath: paths.workspaceSettingsFile,
    attachmentsRootPath: paths.attachmentsRoot,
    permissionsFilePath: paths.permissionsFile,
  })

  const secretStore = new KeychainSecretStoreImpl(resolveKeychainServiceName())
  const browserIdentityPaths = createBrowserIdentityPaths(options.appDataRoot)
  return {
    browserPaths: createAgentBrowserPaths(options.appDataRoot),
    browserIdentityPaths,
    browserIdentity: new BrowserIdentityStore({
      paths: browserIdentityPaths,
      keyStore: secretStore,
      logger,
    }),
    commandEnvironment: options.commandEnvironment,
    data,
    db,
    events: new RuntimeEventBusImpl(),
    logger,
    paths,
    secretStore,
    commandHost,
    oauthCallbackHost: options.oauthCallbackHost,
  }
}
