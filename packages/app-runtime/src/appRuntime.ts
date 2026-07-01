import type {
  AddConversationsSchema,
  AddMcpConfigSchema,
  AIProviderFactory,
  ApprovePendingActionOptions,
  CancelTaskOptions,
  CreateProviderConfigModelSchema,
  CreateProviderConfigSchema,
  GeneralSettingsState,
  IAgentEventEmitter,
  IMessage,
  ImportSkillFromGithubOptions,
  McpConfigSchema,
  RejectPendingActionOptions,
  RunBuiltinCommandParams,
  SetSkillEnabledOptions,
  StartAgentTurnOptions,
  UpdateAgentMemoryInput,
  UpdateConversationsSchema,
  UpdateMcpConfigSchema,
  UpdateProviderConfigSchema,
} from '@ant-chat/shared'
import type { AppRuntimeLoggerOptions } from './runtimeLogger'
import type { SystemLogger } from './systemLogger'
import { randomUUID } from 'node:crypto'
import { createAgentRuntime, createProvider } from '@ant-chat/agent-core'
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
import { NetworkProxyManager } from './networkProxy'
import { createAppRuntimePaths } from './paths'
import { getAppRuntimeLogger } from './runtimeLogger'
import { RuntimeSecretRequestController } from './secretRequestController'
import { KeychainSecretStore } from './secretStore'

export interface CreateAppRuntimeOptions {
  appDataRoot: string
  logger?: SystemLogger
  loggerOptions?: AppRuntimeLoggerOptions
}

export function createAppRuntime(options: CreateAppRuntimeOptions) {
  const paths = createAppRuntimePaths(options.appDataRoot)
  const browserPaths = createAgentBrowserPaths()
  const logger = options.logger ?? getAppRuntimeLogger(options.appDataRoot, options.loggerOptions)
  const networkProxy = new NetworkProxyManager()
  const db = openAppDataDatabase(paths.databaseFile)
  const context = createAppDataContext({
    db,
    settingsFilePath: paths.settingsFile,
    mcpSettingsFilePath: paths.mcpSettingsFile,
    memoryRootPath: paths.memoryRoot,
    workspaceSettingsFilePath: paths.workspaceSettingsFile,
    attachmentsRootPath: paths.attachmentsRoot,
  })
  const events = new RuntimeEventBus()
  const secretStore = new KeychainSecretStore()
  const aiProviderFactory: AIProviderFactory = async ({ provider }) => {
    const apiKey = await resolveProviderApiKey(provider)
    return await createProvider({ ...provider, apiKey }, { logger })
  }
  const secretRequester = new RuntimeSecretRequestController(secretStore, {
    emitSecretRequested(request) {
      events.emit('agent:secret-requested', { request })
    },
  })
  const skills = new SkillManagementService({ skillsRoot: paths.skillsRoot })
  const mcpClientHub = new MCPClientHub(logger)
  const agentEventEmitter: IAgentEventEmitter = {
    emitMessageUpdated(message) {
      events.emit('message:updated', { message })
    },
    emitTaskUpdated(task) {
      events.emit('agent:task-updated', { task })
    },
    emitApprovalRequired(taskId, conversationId, pendingAction) {
      events.emit('agent:approval-required', { taskId, conversationId, pendingAction })
    },
    emitTurnStarted() {},
    emitTurnChunk() {},
    emitTurnToolCalls() {},
    emitTurnToolResults() {},
    emitTurnFinished(params) {
      events.emit('agent:turn-finished', { conversationId: params.conversationId, status: params.status })
    },
  }
  const agentRuntime = createAgentRuntime({
    host: {
      eventEmitter: agentEventEmitter,
      sessionStore: createAppDataSessionStore(context),
      modelCatalog: context.modelCatalog,
      memoryReader: context.memoryManager,
      skillReader: skills,
      mcpClientHub,
      browser: browserPaths,
      loadFileData: context.loadAttachmentData,
      createTaskLogger: createTaskLoggerFactory(paths.taskLogsRoot),
      getToolApprovalWhitelistEntries: () => context.toolApprovalWhitelistRepository.getAll(),
      secretStore,
      secretRequester,
    },
    overrides: { logger, aiProviderFactory },
  })
  const titleGenerator = createConversationTitleGenerator({
    providerSettingsRepository: context.providerSettingsRepository,
    messageRepository: context.messageRepository,
    conversationRepository: context.conversationRepository,
    aiProviderFactory,
  })
  const agentController = createAgentRuntimeController(agentRuntime, context, {
    aiProviderFactory,
    titleGenerator,
    emitConversationUpdated: conversation => events.emit('conversation:updated', { conversation }),
    logger,
  })
  const commandController = createCommandController({
    appDataContext: context,
    eventEmitter: agentEventEmitter,
    logger,
    aiProviderFactory,
    listActiveTasks: conversationId => agentRuntime.listActiveTasks(conversationId),
  })
  const modelsDevImporter = createModelsDevImporter(context)
  let initialized = false
  let disposed = false

  mcpClientHub.addStatusChangeCallback((serverName, status) => {
    if (status !== 'connecting') {
      events.emit('mcp:status-changed', { serverName, status })
    }
  })

  const runtime = {
    chat: {
      createConversationTitle: async (conversationId: string, modelId: string, providerId: string) => {
        const conversation = await titleGenerator.updateTitle(conversationId, { providerId, modelId })
        if (conversation) {
          events.emit('conversation:updated', { conversation })
        }
        return conversation
      },
      listConversations: async (pageIndex: number, pageSize: number, workspacePath?: string) => {
        // 未传 workspacePath = 跨工作区全量查询(含 workspace_path IS NULL);
        // 传了 = 按该路径筛选。不再用 currentWorkspacePath 兜底。
        return await context.conversationRepository.list(pageIndex, pageSize, workspacePath, false)
      },
      getConversation: (id: string) => context.conversationRepository.getById(id),
      createConversation: async (conversation: AddConversationsSchema) => {
        if (!conversation.workspacePath) {
          throw new Error('workspacePath is required')
        }
        const result = await context.conversationRepository.create({
          ...conversation,
          workspacePath: conversation.workspacePath,
        })
        events.emit('conversation:updated', { conversation: result })
        return result
      },
      updateConversation: async (conversation: UpdateConversationsSchema) => {
        const result = await context.conversationRepository.update(conversation)
        events.emit('conversation:updated', { conversation: result })
        return result
      },
      deleteConversation: async (id: string) => {
        await agentRuntime.closeConversation(id)
        await context.conversationRepository.delete(id)
        return null
      },
      clearWorkspaceConversations: async (workspacePath: string) => {
        if (!workspacePath) {
          throw new Error('workspacePath is required')
        }
        const targetWorkspace = workspacePath

        const listResult = await context.conversationRepository.list(0, Number.MAX_SAFE_INTEGER, targetWorkspace, false)
        const targetIds = listResult.data.map(c => c.id)

        if (targetIds.length === 0) {
          return []
        }

        for (const id of targetIds) {
          await agentRuntime.closeConversation(id)
        }

        return await context.conversationRepository.deleteByWorkspace(targetWorkspace, false)
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
        if (!updates.proxySettings) {
          const settings = await context.settingsRepository.updateGeneralSettings(updates)
          events.emit('settings:updated', { keys: Object.keys(updates) })
          return settings
        }

        const currentSettings = await context.settingsRepository.getGeneralSettings()
        const previousProxySettings = currentSettings.proxySettings

        await networkProxy.apply(updates.proxySettings)

        try {
          const settings = await context.settingsRepository.updateGeneralSettings(updates)
          events.emit('settings:updated', { keys: Object.keys(updates) })
          return settings
        }
        catch (persistError) {
          try {
            await networkProxy.apply(previousProxySettings)
          }
          catch {
            // 恢复失败时不覆盖原始错误
          }
          throw persistError
        }
      },
      reset: async () => {
        const settings = await context.settingsRepository.resetGeneralSettings()
        await networkProxy.apply(settings.proxySettings)
        events.emit('settings:updated', { keys: ['all'] })
        return settings
      },
      testProxy: (proxyUrl: string) => networkProxy.test(proxyUrl),
    },
    provider: {
      list: () => context.providerSettingsRepository.listProviders(),
      create: async (config: CreateProviderConfigSchema) => {
        const result = context.providerSettingsRepository.createProvider(await prepareCreateProviderConfig(config))
        events.emit('provider:changed', { providerId: result.id })
        return result
      },
      update: async (config: UpdateProviderConfigSchema) => {
        const result = context.providerSettingsRepository.updateProvider(await prepareProviderSecret(config))
        events.emit('provider:changed', { providerId: result.id })
        return result
      },
      delete: async (id: string) => {
        context.providerSettingsRepository.deleteProvider(id)
        await secretStore.deleteProviderApiKey(id)
        events.emit('provider:changed', { providerId: id })
        return null
      },
      getById: (id: string) => requireValue(context.providerSettingsRepository.getProviderById(id), `Provider not found: ${id}`),
      listAvailableModels: () => context.providerSettingsRepository.getAllAvailableModels(),
      listModels: (id: string) => context.providerSettingsRepository.listProviderModels(id),
      getModel: (providerId: string, modelId: string) => requireValue(context.providerSettingsRepository.getModel(providerId, modelId), `Provider model not found: ${providerId}/${modelId}`),
      setModelEnabled: (id: string, enabled: boolean) => {
        const result = context.providerSettingsRepository.setModelEnabledStatus(id, enabled)
        events.emit('provider:changed', { providerId: result.providerId })
        return result
      },
      createModel: (config: CreateProviderConfigModelSchema) => {
        const result = context.providerSettingsRepository.createProviderModel(config)
        events.emit('provider:changed', { providerId: result.providerId })
        return result
      },
      deleteModel: (id: string) => {
        context.providerSettingsRepository.deleteProviderModel(id)
        events.emit('provider:changed', {})
        return null
      },
      getModelsDevProviders: () => modelsDevImporter.getModelsDevProviders(),
      getModelsDevModels: (providerId: string) => modelsDevImporter.getModelsDevModelsByProviderId(providerId),
      importModelsDevModels: async (providerId: string) => {
        const result = await modelsDevImporter.importModelsDevModels(providerId)
        events.emit('provider:changed', { providerId })
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
      reorder: (paths: string[]) => emitWorkspaceResult(context.workspaceService.reorderWorkspaces(paths)),
      getDefaultPath: () => context.workspaceService.getDefaultWorkspacePath(),
      listDirectories: (path?: string) => context.workspaceService.listDirectories(path),
      createDirectory: (parentPath: string, name: string) => context.workspaceService.createDirectory(parentPath, name),
      searchFiles: async (workspacePath: string, query = '', limit = 50) => {
        if (!workspacePath) {
          throw new Error('workspacePath is required')
        }
        return await searchWorkspaceFiles(workspacePath, query, limit)
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
      resolveSecretRequest: (input: { requestId: string, value?: string, values?: Record<string, string> }) => {
        secretRequester.resolveSecretRequest(input)
        return null
      },
      rejectSecretRequest: (input: { requestId: string, reason?: string }) => {
        secretRequester.rejectSecretRequest(input)
        return null
      },
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
      const migratedSecrets = await context.providerSettingsRepository.migratePlaintextApiKeys(secretStore)
      if (migratedSecrets) {
        events.emit('provider:changed', {})
      }
      const settings = await context.settingsRepository.getGeneralSettings()
      await networkProxy.apply(settings.proxySettings)
      await mcpClientHub.initializeMcpServers(context.mcpSettingsRepository.getMcpConfigs())
      initialized = true
    },
    async dispose() {
      if (disposed)
        return
      disposed = true
      for (const task of agentRuntime.listActiveTasks())
        agentRuntime.cancelTask({ taskId: task.taskId })
      await agentRuntime.dispose()
      await Promise.all(mcpClientHub.connections.map(connection => mcpClientHub.deleteConnection(connection.server.name)))
      await networkProxy.dispose()
      events.clear()
      db.close()
    },
  }

  function emitWorkspaceResult(result: ReturnType<typeof context.workspaceService.listWorkspaces>) {
    events.emit('workspace:changed', {})
    return result
  }

  async function resolveProviderApiKey(provider: { id: string, apiKey?: string, apiKeySecretId?: string }) {
    if (provider.apiKey) {
      return provider.apiKey
    }
    if (provider.apiKeySecretId) {
      const value = await secretStore.resolve({ kind: 'secret_ref', id: provider.apiKeySecretId, scope: 'persistent' })
      if (value) {
        return value
      }
    }
    const value = await secretStore.getProviderApiKey(provider.id)
    if (value) {
      return value
    }
    throw new Error(`Provider API Key not found: ${provider.id}`)
  }

  async function prepareProviderSecret(config: UpdateProviderConfigSchema): Promise<Omit<UpdateProviderConfigSchema, 'apiKey'> & { apiKeySecretId?: string }> {
    if (config.apiKey === undefined) {
      return config
    }
    if (config.apiKey === '') {
      await secretStore.deleteProviderApiKey(config.id)
      const { apiKey: _apiKey, ...safeConfig } = config
      return { ...safeConfig, apiKeySecretId: undefined }
    }
    const ref = await secretStore.saveProviderApiKey({
      providerId: config.id,
      apiKey: config.apiKey,
    })
    const { apiKey: _apiKey, ...safeConfig } = config
    return { ...safeConfig, apiKeySecretId: ref.id }
  }

  async function prepareCreateProviderConfig(config: CreateProviderConfigSchema): Promise<Omit<CreateProviderConfigSchema, 'apiKey'> & { id: string, apiKeySecretId?: string }> {
    const id = config.id ?? `provider-${randomUUID()}`
    if (!config.apiKey) {
      const { apiKey: _apiKey, ...safeConfig } = config
      return { ...safeConfig, id }
    }
    const ref = await secretStore.saveProviderApiKey({
      providerId: id,
      apiKey: config.apiKey,
    })
    const { apiKey: _apiKey, ...safeConfig } = config
    return { ...safeConfig, id, apiKeySecretId: ref.id }
  }

  return runtime
}

function requireValue<T>(value: T, message: string): NonNullable<T> {
  if (value === undefined || value === null)
    throw new Error(message)
  return value as NonNullable<T>
}

export type AppRuntime = ReturnType<typeof createAppRuntime>
