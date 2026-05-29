import type { AgentRuntime, ILogger } from '@ant-chat/agent-core'
import type { AppDataServices } from '@ant-chat/app-data'
import type { IAgentEventEmitter } from '@ant-chat/shared'
import type { Database } from 'better-sqlite3'
import type { AgentRuntimePaths } from './paths'
import { createAgentRuntime, SkillFsReader } from '@ant-chat/agent-core'
import { createAppDataServices } from '@ant-chat/app-data'
import { createAgentRuntimeService } from './agentService'
import { openAppDataDatabase } from './database'
import { createAgentRuntimePaths } from './paths'
import { createAppDataSessionStore } from './sessionStore'
import { createTaskLoggerFactory } from './taskLogWriter'

export interface CreateAgentRuntimeEnvironmentOptions {
  appDataRoot: string
  eventEmitter: IAgentEventEmitter
  logger?: ILogger
  databaseTimeoutMs?: number
}

export interface CreateAgentRuntimeEnvironmentFromServicesOptions {
  paths: AgentRuntimePaths
  appDataServices: AppDataServices
  eventEmitter: IAgentEventEmitter
  logger?: ILogger
}

export interface AgentRuntimeEnvironment {
  paths: AgentRuntimePaths
  db?: Database
  appDataServices: AppDataServices
  skillManagementService: SkillFsReader
  runtime: AgentRuntime
  agentService: ReturnType<typeof createAgentRuntimeService>
}

export function createAgentRuntimeEnvironment(
  options: CreateAgentRuntimeEnvironmentOptions,
): AgentRuntimeEnvironment {
  const paths = createAgentRuntimePaths(options.appDataRoot)
  const db = openAppDataDatabase(paths.databaseFile, { timeoutMs: options.databaseTimeoutMs })
  const appDataServices = createAppDataServices({
    db,
    settingsFilePath: paths.settingsFile,
    mcpSettingsFilePath: paths.mcpSettingsFile,
    workspaceSettingsFilePath: paths.workspaceSettingsFile,
  })
  return {
    ...createAgentRuntimeEnvironmentFromServices({
      paths,
      appDataServices,
      eventEmitter: options.eventEmitter,
      logger: options.logger,
    }),
    db,
  }
}

export function createAgentRuntimeEnvironmentFromServices(
  options: CreateAgentRuntimeEnvironmentFromServicesOptions,
): AgentRuntimeEnvironment {
  const { paths, appDataServices } = options
  const skillManagementService = new SkillFsReader({ skillsRoot: paths.skillsRoot })
  const runtime = createAgentRuntime({
    host: {
      eventEmitter: options.eventEmitter,
      sessionStore: createAppDataSessionStore(appDataServices),
      modelCatalog: appDataServices.modelCatalog,
      skillsRoot: paths.skillsRoot,
      createTaskLogger: createTaskLoggerFactory(paths.taskLogsRoot),
      getToolApprovalWhitelistEntries: () => appDataServices.toolApprovalWhitelistRepository.getAll(),
    },
    overrides: options.logger ? { logger: options.logger } : undefined,
  })

  return {
    paths,
    appDataServices,
    skillManagementService,
    runtime,
    agentService: createAgentRuntimeService(runtime, appDataServices),
  }
}
