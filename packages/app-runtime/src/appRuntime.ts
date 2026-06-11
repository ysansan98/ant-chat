import type { ILogger } from '@ant-chat/agent-core'
import type {
  AddConversationsSchema,
  AddMcpConfigSchema,
  ApprovePendingActionOptions,
  CancelTaskOptions,
  CreateProviderConfigModelSchema,
  CreateProviderConfigSchema,
  GeneralSettingsState,
  IAgentEventEmitter,
  IMessage,
  ImportSkillFromGithubOptions,
  McpConfigSchema,
  ProxySettings,
  RejectPendingActionOptions,
  RunBuiltinCommandParams,
  SetSkillEnabledOptions,
  StartAgentTurnOptions,
  UpdateAgentMemoryInput,
  UpdateConversationsSchema,
  UpdateMcpConfigSchema,
  UpdateProviderConfigSchema,
} from '@ant-chat/shared'
import { createAgentRuntime } from '@ant-chat/agent-core'
import {
  createAgentRuntimeController,
  createAppDataSessionStore,
  createCommandController,
  createConversationTitleGenerator,
  createModelsDevImporter,
  createTaskLoggerFactory,
  SkillManagementService,
} from '@ant-chat/agent-runtime'
import { createAppDataContext, searchWorkspaceFiles } from '@ant-chat/app-data'
import { MCPClientHub } from '@ant-chat/mcp-client-hub'
import { AddMessage, UpdateMessageSchema } from '@ant-chat/shared'
import { createAgentBrowserPaths } from './agentBrowser'
import { openAppDataDatabase } from './database'
import { RuntimeEventBus } from './events'
import { createAppRuntimePaths } from './paths'

export interface AppRuntimeHost {
  browser?: {
    executablePath: string
    proxyUrl?: string
  }
  proxy: {
    apply: (settings: ProxySettings) => Promise<void>
    test: (proxyUrl: string) => Promise<boolean>
  }
}

export interface CreateAppRuntimeOptions {
  appDataRoot: string
  host: AppRuntimeHost
  logger?: ILogger
  databaseTimeoutMs?: number
}

export function createAppRuntime(options: CreateAppRuntimeOptions) {
  const paths = createAppRuntimePaths(options.appDataRoot)
  const browserPaths = createAgentBrowserPaths()
  const db = openAppDataDatabase(paths.databaseFile, { timeoutMs: options.databaseTimeoutMs })
  const context = createAppDataContext({
    db,
    settingsFilePath: paths.settingsFile,
    mcpSettingsFilePath: paths.mcpSettingsFile,
    memoryRootPath: paths.memoryRoot,
    workspaceSettingsFilePath: paths.workspaceSettingsFile,
    attachmentsRootPath: paths.attachmentsRoot,
  })
  const events = new RuntimeEventBus()
  const skills = new SkillManagementService({ skillsRoot: paths.skillsRoot })
  const mcpClientHub = new MCPClientHub()
  const agentEventEmitter: IAgentEventEmitter = {
    emitMessageUpdated(message) {
      events.emit('message.updated', { message })
    },
    emitTaskUpdated(task) {
      events.emit('agent.task.updated', { task })
    },
    emitApprovalRequired(taskId, conversationId, pendingAction) {
      events.emit('agent.approval.required', { taskId, conversationId, pendingAction })
    },
    emitTurnStarted() {},
    emitTurnChunk() {},
    emitTurnToolCalls() {},
    emitTurnToolResults() {},
    emitTurnFinished() {},
  }
  const agentRuntime = createAgentRuntime({
    host: {
      eventEmitter: agentEventEmitter,
      sessionStore: createAppDataSessionStore(context),
      modelCatalog: context.modelCatalog,
      memoryReader: context.memoryManager,
      skillReader: skills,
      mcpClientHub,
      browser: options.host.browser
        ? {
            executablePath: options.host.browser.executablePath,
            proxyUrl: options.host.browser.proxyUrl,
            ...browserPaths,
          }
        : undefined,
      loadFileData: context.loadAttachmentData,
      createTaskLogger: createTaskLoggerFactory(paths.taskLogsRoot),
      getToolApprovalWhitelistEntries: () => context.toolApprovalWhitelistRepository.getAll(),
    },
    overrides: options.logger ? { logger: options.logger } : undefined,
  })
  const agentController = createAgentRuntimeController(agentRuntime, context)
  const commandController = createCommandController({
    appDataContext: context,
    eventEmitter: agentEventEmitter,
    logger: options.logger,
    listActiveTasks: conversationId => agentRuntime.listActiveTasks(conversationId),
  })
  const titleGenerator = createConversationTitleGenerator({
    providerSettingsRepository: context.providerSettingsRepository,
    messageRepository: context.messageRepository,
    conversationRepository: context.conversationRepository,
  })
  const modelsDevImporter = createModelsDevImporter(context)
  let initialized = false
  let disposed = false

  mcpClientHub.addStatusChangeCallback((serverName, status) => {
    if (status !== 'connecting') {
      events.emit('mcp.connection.changed', { serverName, status })
    }
  })

  const runtime = {
    chat: {
      createConversationTitle: (conversationId: string, modelId: string) =>
        titleGenerator.updateTitle(conversationId, modelId),
      listConversations: async (pageIndex: number, pageSize: number, workspacePath?: string) => {
        const targetWorkspace = workspacePath ?? context.workspaceService.getCurrentWorkspacePath()
        const includeNullWorkspace = targetWorkspace === context.workspaceService.getDefaultWorkspacePath()
        return await context.conversationRepository.list(pageIndex, pageSize, targetWorkspace, includeNullWorkspace)
      },
      getConversation: (id: string) => context.conversationRepository.getById(id),
      createConversation: (conversation: AddConversationsSchema) => context.conversationRepository.create({
        ...conversation,
        workspacePath: conversation.workspacePath ?? context.workspaceService.getCurrentWorkspacePath(),
      }),
      updateConversation: (conversation: UpdateConversationsSchema) => context.conversationRepository.update(conversation),
      deleteConversation: async (id: string) => {
        await context.conversationRepository.delete(id)
        return null
      },
      listMessages: (conversationId: string) => context.messageRepository.listByConversation(conversationId),
      getMessage: (id: string) => context.messageRepository.getById(id),
      createMessage: (message: IMessage) => context.messageRepository.create(AddMessage.parse(message)),
      updateMessage: (message: IMessage) => context.messageRepository.update(UpdateMessageSchema.parse(message)),
      deleteMessage: async (id: string) => {
        await context.messageRepository.delete(id)
        return null
      },
      batchDeleteMessages: async (ids: string[]) => {
        await context.messageRepository.batchDelete(ids)
        return null
      },
    },
    settings: {
      get: () => context.settingsRepository.getGeneralSettings(),
      update: async (updates: Partial<GeneralSettingsState>) => {
        const settings = await context.settingsRepository.updateGeneralSettings(updates)
        if (updates.proxySettings)
          await options.host.proxy.apply(updates.proxySettings)
        events.emit('settings.changed', { keys: Object.keys(updates) })
        return settings
      },
      reset: async () => {
        const settings = await context.settingsRepository.resetGeneralSettings()
        await options.host.proxy.apply(settings.proxySettings)
        events.emit('settings.changed', { keys: ['all'] })
        return settings
      },
      testProxy: (proxyUrl: string) => options.host.proxy.test(proxyUrl),
    },
    provider: {
      list: () => context.providerSettingsRepository.listProviders(),
      create: (config: CreateProviderConfigSchema) => {
        const result = context.providerSettingsRepository.createProvider(config)
        events.emit('provider.changed', { providerId: result.id })
        return result
      },
      update: (config: UpdateProviderConfigSchema) => {
        const result = context.providerSettingsRepository.updateProvider(config)
        events.emit('provider.changed', { providerId: result.id })
        return result
      },
      delete: (id: string) => {
        context.providerSettingsRepository.deleteProvider(id)
        events.emit('provider.changed', { providerId: id })
        return null
      },
      getById: (id: string) => requireValue(context.providerSettingsRepository.getProviderById(id), `Provider not found: ${id}`),
      getByModelId: (id: string) => requireValue(context.providerSettingsRepository.getProviderByModelId(id), `Provider model not found: ${id}`),
      listAvailableModels: () => context.providerSettingsRepository.getAllAvailableModels(),
      listModels: (id: string) => context.providerSettingsRepository.listProviderModels(id),
      getModel: (id: string) => requireValue(context.providerSettingsRepository.getModelById(id), `Provider model not found: ${id}`),
      setModelEnabled: (id: string, enabled: boolean) => {
        const result = context.providerSettingsRepository.setModelEnabledStatus(id, enabled)
        events.emit('provider.changed', { providerId: result.providerId })
        return result
      },
      createModel: (config: CreateProviderConfigModelSchema) => {
        const result = context.providerSettingsRepository.createProviderModel(config)
        events.emit('provider.changed', { providerId: result.providerId })
        return result
      },
      deleteModel: (id: string) => {
        context.providerSettingsRepository.deleteProviderModel(id)
        events.emit('provider.changed', {})
        return null
      },
      getModelsDevProviders: () => modelsDevImporter.getModelsDevProviders(),
      getModelsDevModels: (providerId: string) => modelsDevImporter.getModelsDevModelsByProviderId(providerId),
      importModelsDevModels: async (providerId: string) => {
        const result = await modelsDevImporter.importModelsDevModels(providerId)
        events.emit('provider.changed', { providerId })
        return result
      },
    },
    mcp: {
      getConfigs: () => context.mcpSettingsRepository.getMcpConfigs(),
      getConfig: (serverName: string) => requireValue(
        context.mcpSettingsRepository.getMcpConfigByServerName(serverName),
        `MCP server not found: ${serverName}`,
      ),
      addConfig: (config: AddMcpConfigSchema) => context.mcpSettingsRepository.addMcpConfig(config),
      updateConfig: (config: UpdateMcpConfigSchema) => context.mcpSettingsRepository.updateMcpConfig(config),
      deleteConfig: (serverName: string) => {
        context.mcpSettingsRepository.deleteMcpConfig(serverName)
        return null
      },
      getConnections: () => mcpClientHub.connections.map(({ server }) => ({
        name: server.name,
        config: server.config,
        tools: server.tools ?? [],
        status: server.status,
      })),
      getAllTools: () => mcpClientHub.getAllAvailableToolsList(),
      callTool: async (serverName: string, toolName: string, toolArguments?: Record<string, unknown>) => {
        const result = await mcpClientHub.callTool(serverName, toolName, toolArguments)
        return {
          content: (result.content ?? []).filter(item => item.type === 'text'),
          isError: result.isError,
        }
      },
      connect: async (name: string, config: McpConfigSchema) => {
        await mcpClientHub.connectToServer(name, config)
        return null
      },
      disconnect: async (name: string) => {
        await mcpClientHub.deleteConnection(name)
        return null
      },
      reconnect: async (name: string, config: McpConfigSchema) => {
        await mcpClientHub.deleteConnection(name)
        await mcpClientHub.connectToServer(name, config)
        return null
      },
      fetchTools: (name: string) => mcpClientHub.fetchToolsList(name),
      setEnabled: async (enabled: boolean, configs?: McpConfigSchema[]) => {
        if (enabled) {
          if (!configs)
            throw new Error('MCP configs are required when enabling MCP')
          await mcpClientHub.initializeMcpServers(configs)
        }
        else {
          await Promise.all(mcpClientHub.connections.map(connection => mcpClientHub.deleteConnection(connection.server.name)))
        }
        return null
      },
    },
    search: {
      messages: (query: string) => context.messageSearchQuery.searchMessagesByKeyword(query),
    },
    memory: {
      getFiles: () => context.memoryManager.readMemoryFiles(),
      updateFiles: (input: UpdateAgentMemoryInput) => context.memoryManager.updateMemoryFiles(input),
      rollbackSoul: () => context.memoryManager.rollbackSoul(),
    },
    skills: {
      list: () => skills.listSkills(),
      importZip: (filePath: string) => skills.importFromZip(filePath),
      importGithub: (input: ImportSkillFromGithubOptions) => skills.importFromGithub(input),
      setEnabled: (input: SetSkillEnabledOptions) => skills.setEnabled(input.name, input.enabled),
      delete: async (name: string) => {
        await skills.deleteSkill(name)
        return null
      },
      rebuildIndex: async () => ({
        rootPath: skills.getSkillsRoot(),
        skills: await skills.rebuildIndex(),
      }),
    },
    workspace: {
      list: () => context.workspaceService.listWorkspaces(),
      add: (path: string) => emitWorkspaceResult(context.workspaceService.addWorkspace(path)),
      remove: (path: string) => emitWorkspaceResult(context.workspaceService.removeWorkspace(path)),
      open: (path: string) => emitWorkspaceResult(context.workspaceService.openWorkspace(path)),
      getCurrentPath: () => context.workspaceService.getCurrentWorkspacePath(),
      getDefaultPath: () => context.workspaceService.getDefaultWorkspacePath(),
      listDirectories: (path?: string) => context.workspaceService.listDirectories(path),
      createDirectory: (parentPath: string, name: string) => context.workspaceService.createDirectory(parentPath, name),
      searchFiles: async (query = '', limit = 50) => {
        const workspacePath = context.workspaceService.getCurrentWorkspacePath()
        return workspacePath ? await searchWorkspaceFiles(workspacePath, query, limit) : []
      },
    },
    agent: {
      startTurn: (input: StartAgentTurnOptions) => agentController.startTurn(input),
      approvePendingAction: (input: ApprovePendingActionOptions) => agentController.approvePendingAction(input),
      rejectPendingAction: (input: RejectPendingActionOptions) => agentController.rejectPendingAction(input),
      cancelTask: (input: CancelTaskOptions) => agentController.cancelTask(input),
      getTask: (taskId: string) => agentRuntime.getTask(taskId),
      listActiveTasks: (conversationId?: string) => agentController.listActiveTasks(conversationId),
      injectSteering: (input: { conversationId: string, text: string }) => agentController.injectSteering(input),
      approvePendingActionWithWhitelist: (
        input: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string },
      ) => agentController.approvePendingActionWithWhitelist(input),
    },
    commands: {
      run: (input: RunBuiltinCommandParams) => commandController.runBuiltinCommand(input),
      cancel: async (conversationId: string) => {
        await commandController.cancelCommand(conversationId)
        return null
      },
    },
    events,
    async initialize() {
      if (initialized)
        return
      if (disposed)
        throw new Error('AppRuntime has been disposed')
      context.workspaceService.ensureInitialized()
      await skills.ensureInitialized()
      const settings = await context.settingsRepository.getGeneralSettings()
      await options.host.proxy.apply(settings.proxySettings)
      await mcpClientHub.initializeMcpServers(context.mcpSettingsRepository.getMcpConfigs())
      initialized = true
    },
    async dispose() {
      if (disposed)
        return
      disposed = true
      for (const task of agentRuntime.listActiveTasks())
        agentRuntime.cancelTask({ taskId: task.taskId })
      await Promise.all(mcpClientHub.connections.map(connection => mcpClientHub.deleteConnection(connection.server.name)))
      events.clear()
      db.close()
    },
  }

  function emitWorkspaceResult(result: ReturnType<typeof context.workspaceService.listWorkspaces>) {
    events.emit('workspace.changed', { currentWorkspacePath: result.currentWorkspacePath })
    return result
  }

  return runtime
}

function requireValue<T>(value: T, message: string): NonNullable<T> {
  if (value === undefined || value === null)
    throw new Error(message)
  return value as NonNullable<T>
}

export type AppRuntime = ReturnType<typeof createAppRuntime>
