import type { AgentRuntime, ILogger } from '@ant-chat/agent-core'
import type { AppDataContext } from '@ant-chat/app-data'
import type { IAgentEventEmitter } from '@ant-chat/shared'
import type { Database } from 'better-sqlite3'
import type { AgentRuntimePaths } from './paths'
import { createAgentRuntime } from '@ant-chat/agent-core'
import { createAppDataContext } from '@ant-chat/app-data'
import { MCPClientHub } from '@ant-chat/mcp-client-hub'
import { createAgentRuntimeController } from './agentRuntimeController'
import { openAppDataDatabase } from './database'
import { createAgentRuntimePaths } from './paths'
import { createAppDataSessionStore } from './sessionStore'
import { SkillManagementService } from './skills'
import { createTaskLoggerFactory } from './taskLogWriter'

export interface CreateAgentRuntimeEnvironmentOptions {
  appDataRoot: string
  eventEmitter: IAgentEventEmitter
  logger?: ILogger
  databaseTimeoutMs?: number
}

export interface CreateAgentRuntimeEnvironmentFromContextOptions {
  paths: AgentRuntimePaths
  appDataContext: AppDataContext
  eventEmitter: IAgentEventEmitter
  logger?: ILogger
}

export interface AgentRuntimeEnvironment {
  paths: AgentRuntimePaths
  db?: Database
  appDataContext: AppDataContext
  skillManagementService: SkillManagementService
  mcpClientHub: MCPClientHub
  runtime: AgentRuntime
  agentController: ReturnType<typeof createAgentRuntimeController>
}

export function createAgentRuntimeEnvironment(
  options: CreateAgentRuntimeEnvironmentOptions,
): AgentRuntimeEnvironment {
  const paths = createAgentRuntimePaths(options.appDataRoot)
  const db = openAppDataDatabase(paths.databaseFile, { timeoutMs: options.databaseTimeoutMs })
  const appDataContext = createAppDataContext({
    db,
    settingsFilePath: paths.settingsFile,
    mcpSettingsFilePath: paths.mcpSettingsFile,
    memoryRootPath: paths.memoryRoot,
    workspaceSettingsFilePath: paths.workspaceSettingsFile,
  })
  return {
    ...createAgentRuntimeEnvironmentFromContext({
      paths,
      appDataContext,
      eventEmitter: options.eventEmitter,
      logger: options.logger,
    }),
    db,
  }
}

export function createAgentRuntimeEnvironmentFromContext(
  options: CreateAgentRuntimeEnvironmentFromContextOptions,
): AgentRuntimeEnvironment {
  const { paths, appDataContext } = options
  const skillManagementService = new SkillManagementService({ skillsRoot: paths.skillsRoot })
  const mcpClientHub = new MCPClientHub()
  const runtime = createAgentRuntime({
    host: {
      eventEmitter: options.eventEmitter,
      sessionStore: createAppDataSessionStore(appDataContext),
      modelCatalog: appDataContext.modelCatalog,
      memoryReader: appDataContext.memoryManager,
      skillReader: skillManagementService,
      mcpClientHub,
      createTaskLogger: createTaskLoggerFactory(paths.taskLogsRoot),
      getToolApprovalWhitelistEntries: () => appDataContext.toolApprovalWhitelistRepository.getAll(),
    },
    overrides: options.logger ? { logger: options.logger } : undefined,
  })

  return {
    paths,
    appDataContext,
    skillManagementService,
    mcpClientHub,
    runtime,
    agentController: createAgentRuntimeController(runtime, appDataContext),
  }
}
