import type {
  AppRpcInput,
  McpConfigSchema,
  McpServer,
  McpServerEditPatch,
  McpServerLifecycleResult,
  McpServerTestResult,
} from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { randomUUID } from 'node:crypto'
import { McpConfigSchema as McpConfigValidator } from '@ant-chat/shared'
import { McpConnectionManager, McpOAuthCredentialStore, OAuthCoordinator } from '../../../mcp'
import { Method, Module } from '../../decorators'
import { registerOAuthCallbackHandler } from '../../types'

@Module('mcp')
export class McpModule implements RuntimeModuleMethods<'mcp'> {
  readonly clientHub: McpConnectionManager
  private readonly lifecycleOperations = new Set<string>()
  private readonly oauthCoordinator = new OAuthCoordinator()
  private readonly removeOAuthCallbackHandler: () => void
  /** 启动时后台自动连接任务；测试可等待其完成，运行时不阻塞应用激活。 */
  autoConnectPromise: Promise<void> | undefined
  /** OAuth 测试连接只按一次性 attempt 关联，不能由可变的 serverName 劫持。 */
  private readonly testSessions = new Map<string, { config: McpConfigSchema, probe: McpConnectionManager, result?: McpServerTestResult }>()

  constructor(
    private readonly core: Pick<RuntimeCore, 'data' | 'events' | 'logger' | 'oauthCallbackHost' | 'secretStore'>,
    clientHub: McpConnectionManager = new McpConnectionManager(core.logger, undefined, new McpOAuthCredentialStore(core.secretStore)),
    private readonly createClientHub: () => McpConnectionManager = () => new McpConnectionManager(core.logger, undefined, new McpOAuthCredentialStore(core.secretStore)),
  ) {
    this.clientHub = clientHub
    // OAuth transport 需要回调地址构造 authProvider；缺少时 SDK 收到 401 无法进入授权流程。
    if (core.oauthCallbackHost) {
      this.clientHub.setOAuthRedirectUrl(core.oauthCallbackHost.redirectUrl)
    }
    this.removeOAuthCallbackHandler = registerOAuthCallbackHandler(core.oauthCallbackHost, async (params) => {
      const consumed = this.oauthCoordinator.consumeCallback(params)
      if (!consumed)
        return false
      if (consumed.attempt.purpose === 'test') {
        await this.finishTestOAuth(consumed.attempt.id, params, consumed.attempt.error)
        return true
      }
      const config = this.core.data.mcpSettingsRepository.getMcpConfigByServerId(consumed.attempt.serverId)
      if (!config)
        throw new Error('OAuth 对应的 MCP server 已被删除。')
      if (consumed.attempt.error) {
        await this.clientHub.deleteConnection(config.serverName).catch(() => false)
        this.emitStatus(config.serverName, 'disconnected', consumed.attempt.error)
        return true
      }
      try {
        const connected = await this.clientHub.finishOAuthAuth(config.serverName, params)
        if (!connected)
          throw new Error('OAuth 授权完成后未能建立 MCP 连接。')
        this.oauthCoordinator.complete(consumed.attempt.id)
      }
      catch (error) {
        this.oauthCoordinator.fail(consumed.attempt.id, error)
        throw error
      }
      return true
    })
    this.clientHub.addStatusChangeCallback((serverName, status) => {
      if (!this.lifecycleOperations.has(serverName) && status !== 'connecting')
        core.events.emit('mcp:status-changed', { serverName, status })
    })
    this.clientHub.addErrorCallback((serverName, error) => {
      if (this.lifecycleOperations.has(serverName))
        return
      core.events.emit('mcp:status-changed', {
        error: error.message,
        serverName,
        status: 'disconnected',
      })
    })
  }

  initialize() {
    // 应用启动的自动连接放到后台，不阻塞 runtime 激活：
    // npx 首次下载、远程握手超时等慢/失败场景不应拖住整个应用启动。
    // 连接结果通过 mcp:status-changed 事件反馈，UI 照常展示状态；
    // 自动连接不弹交互式 OAuth 授权，需要授权时保持未运行，由用户手动启动。
    this.autoConnectPromise = Promise.all(
      this.core.data.mcpSettingsRepository.getMcpConfigs()
        .filter(config => config.enabled !== false)
        .map(config => this.connect(config, false, false)),
    ).then(() => undefined)
    return Promise.resolve()
  }

  async dispose() {
    this.removeOAuthCallbackHandler()
    await Promise.all([
      ...this.clientHub.connections.map(connection => this.clientHub.deleteConnection(connection.server.name)),
      ...[...this.testSessions.keys()].map(attemptId => this.disposeTestSession(attemptId)),
    ])
  }

  @Method()
  getConfigs(_input?: AppRpcInput<'mcp.getConfigs'>) {
    return this.core.data.mcpSettingsRepository.getMcpConfigs()
  }

  @Method()
  getConfigByServerName(input: AppRpcInput<'mcp.getConfigByServerName'>) {
    return this.requireConfig(input.serverName)
  }

  @Method()
  getConnections(_input?: AppRpcInput<'mcp.getConnections'>) {
    return this.clientHub.connections.map(({ server }) => ({
      name: server.name,
      config: server.config,
      tools: server.tools ?? [],
      status: server.status,
    }))
  }

  @Method()
  getAllAvailableToolsList(_input: AppRpcInput<'mcp.getAllAvailableToolsList'>) {
    return this.clientHub.getAllAvailableToolsList()
  }

  @Method()
  async callTool(input: AppRpcInput<'mcp.callTool'>) {
    const result = await this.clientHub.callTool(input.serverName, input.toolName, input.toolArguments)
    return {
      content: (result.content ?? []).filter(item => item.type === 'text'),
      isError: result.isError,
    }
  }

  /** 安装配置并尝试启动；启动失败时保留配置，并返回统一失败状态。 */
  @Method()
  async installServer(input: AppRpcInput<'mcp.installServer'>): Promise<McpServerLifecycleResult> {
    const saved = this.core.data.mcpSettingsRepository.addMcpConfig(input.config)
    this.emitChanged(saved.serverName)
    return this.connect(saved, true)
  }

  /** 编辑配置；运行中的 server 由 module 自行停止、替换配置并重启。 */
  @Method()
  async editServer(input: AppRpcInput<'mcp.editServer'>): Promise<McpServerLifecycleResult> {
    const current = this.requireConfig(input.serverName)
    const next = mergeConfig(current, input.updates)
    if (next.serverName !== input.serverName && this.core.data.mcpSettingsRepository.getMcpConfigByServerName(next.serverName))
      throw new Error(`MCP server 已存在：${next.serverName}`)
    const connectionStatus = this.getConnectionStatus(input.serverName)
    const wasRunning = connectionStatus === 'connected' || connectionStatus === 'connecting'
    const isRename = next.serverName !== input.serverName
    const permissionSnapshot = isRename
      ? this.core.data.permissionsFileStore.listAll()
      : undefined

    if (connectionStatus) {
      const stopped = await this.disconnect(current)
      if (stopped.error)
        return stopped
    }

    let saved: McpConfigSchema
    try {
      saved = this.core.data.mcpSettingsRepository.replaceMcpConfig(input.serverName, next)
    }
    catch (error) {
      if (wasRunning) {
        const recovery = await this.connect(current)
        if (recovery.error) {
          const updateError = error instanceof Error ? error.message : String(error)
          throw new Error(`更新 MCP server 失败（${updateError}），且旧连接恢复失败：${recovery.error}`)
        }
      }
      throw error
    }

    if (isRename) {
      try {
        this.core.data.permissionsFileStore.migrateMcpServerName(input.serverName, saved.serverName)
      }
      catch (error) {
        const rollbackErrors: string[] = []
        let configRestored = true
        try {
          this.core.data.permissionsFileStore.write(permissionSnapshot!)
        }
        catch (rollbackError) {
          rollbackErrors.push(`权限规则回滚失败：${errorMessage(rollbackError)}`)
        }
        try {
          this.core.data.mcpSettingsRepository.replaceMcpConfig(saved.serverName, current)
        }
        catch (rollbackError) {
          configRestored = false
          rollbackErrors.push(`配置回滚失败：${errorMessage(rollbackError)}`)
        }
        if (wasRunning && configRestored) {
          const recovery = await this.connect(current)
          if (recovery.error)
            rollbackErrors.push(`旧连接恢复失败：${recovery.error}`)
        }
        const details = rollbackErrors.length > 0 ? `；${rollbackErrors.join('；')}` : ''
        throw new Error(`MCP 重命名事务失败：${errorMessage(error)}${details}`)
      }
    }

    this.emitChanged(saved.serverName)
    return wasRunning ? this.connect(saved, true) : this.result(saved, 'disconnected')
  }

  /** 删除时先停止连接；停止失败则保留配置供调用方重试。 */
  @Method()
  async deleteServer(input: AppRpcInput<'mcp.deleteServer'>): Promise<McpServerLifecycleResult> {
    const config = this.requireConfig(input.serverName)
    this.oauthCoordinator.cancelForServer(config.serverId)
    const connectionStatus = this.getConnectionStatus(input.serverName)
    const wasRunning = connectionStatus === 'connected' || connectionStatus === 'connecting'
    const permissionSnapshot = input.deletePermissionRules
      ? this.core.data.permissionsFileStore.listAll()
      : undefined
    const stopped = await this.disconnect(config)
    if (stopped.error)
      return stopped

    this.core.data.mcpSettingsRepository.deleteMcpConfig(input.serverName)
    if (input.deletePermissionRules) {
      try {
        this.core.data.permissionsFileStore.deleteMcpServerRules(input.serverName)
      }
      catch (error) {
        const rollbackErrors: string[] = []
        let configRestored = true
        try {
          this.core.data.permissionsFileStore.write(permissionSnapshot!)
        }
        catch (rollbackError) {
          rollbackErrors.push(`权限规则回滚失败：${errorMessage(rollbackError)}`)
        }
        try {
          this.core.data.mcpSettingsRepository.addMcpConfig(config)
        }
        catch (rollbackError) {
          configRestored = false
          rollbackErrors.push(`配置回滚失败：${errorMessage(rollbackError)}`)
        }
        if (wasRunning && configRestored) {
          const recovery = await this.connect(config)
          if (recovery.error)
            rollbackErrors.push(`旧连接恢复失败：${recovery.error}`)
        }
        const details = rollbackErrors.length > 0 ? `；${rollbackErrors.join('；')}` : ''
        throw new Error(`删除 MCP server 事务失败：${errorMessage(error)}${details}`)
      }
    }
    this.emitChanged(input.serverName)
    return stopped
  }

  /** 从持久化配置启动，调用方不需要重新读取和传回配置。 */
  @Method()
  async startServer(input: AppRpcInput<'mcp.startServer'>): Promise<McpServerLifecycleResult> {
    const config = this.requireConfig(input.serverName)
    const status = this.getConnectionStatus(input.serverName)
    if (status === 'connected' || status === 'connecting')
      return this.result(config, status)
    if (status) {
      const stopped = await this.disconnect(config)
      if (stopped.error)
        return stopped
    }
    return this.connect(config)
  }

  /** 幂等停止，并返回与其他生命周期动作相同的结果结构。 */
  @Method()
  async stopServer(input: AppRpcInput<'mcp.stopServer'>): Promise<McpServerLifecycleResult> {
    return this.disconnect(this.requireConfig(input.serverName))
  }

  /** 启用/禁用持久化开关；启用立即启动，禁用立即停止，与生命周期状态保持一致。 */
  @Method()
  async setServerEnabled(input: AppRpcInput<'mcp.setServerEnabled'>): Promise<McpServerLifecycleResult> {
    const config = this.requireConfig(input.serverName)
    const next = this.core.data.mcpSettingsRepository.replaceMcpConfig(input.serverName, {
      ...config,
      enabled: input.enabled,
    })
    this.emitChanged(input.serverName)
    if (!input.enabled) {
      const stopped = await this.disconnect(next)
      return { ...stopped, configSaved: true }
    }
    const status = this.getConnectionStatus(input.serverName)
    if (status === 'connected' || status === 'connecting')
      return this.result(next, status)
    if (status) {
      const stopped = await this.disconnect(next)
      if (stopped.error)
        return { ...stopped, configSaved: true }
    }
    return this.connect(next, true)
  }

  /** 使用隔离连接预检未保存配置，不污染持久化配置和正式连接状态。 */
  @Method()
  async testServer(input: AppRpcInput<'mcp.testServer'>): Promise<McpServerTestResult> {
    const config = McpConfigValidator.parse({ ...input.config, serverId: randomUUID() })

    if ('authType' in config && config.authType === 'oauth') {
      const redirectUrl = this.clientHub.getOAuthRedirectUrl()
      if (!redirectUrl) {
        return { serverName: config.serverName, tools: [], error: 'OAuth 回调服务未启动，无法测试连接' }
      }
      const attempt = this.oauthCoordinator.begin({ purpose: 'test', serverId: config.serverId })
      const probe = new McpConnectionManager(this.core.logger, redirectUrl, new McpOAuthCredentialStore(this.core.secretStore))
      try {
        probe.prepareOAuthState(config.serverName, attempt.state)
        const connected = await probe.connectToServer(config.serverName, config)
        if (!connected) {
          const authUrl = probe.getPendingOAuthUrl(config.serverName)
          if (!authUrl) {
            this.oauthCoordinator.fail(attempt.id, new Error('无法获取 OAuth 授权地址'))
            return { serverName: config.serverName, tools: [], error: '无法获取 OAuth 授权地址' }
          }
          this.oauthCoordinator.markAuthorizationRequired({ attemptId: attempt.id, authorizationUrl: authUrl })
          this.testSessions.set(attempt.id, { config, probe })
          await this.core.oauthCallbackHost?.openAuthorization(authUrl)
          return {
            serverName: config.serverName,
            tools: [],
            oauthRequired: true,
            attemptId: attempt.id,
          }
        }
        const tools = probe.connections.find(c => c.server.name === config.serverName)?.server.tools
          ?? await probe.fetchToolsList(config.serverName)
        return { serverName: config.serverName, tools }
      }
      catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          serverName: config.serverName,
          tools: [],
        }
      }
      finally {
        if (!this.testSessions.has(attempt.id)) {
          await probe.deleteConnection(config.serverName).catch(() => false)
          this.oauthCoordinator.dispose(attempt.id)
        }
      }
    }

    // 非 OAuth 的测试连接（stdio 或未启用 OAuth 的 SSE）
    const probe = this.createClientHub()
    try {
      const connected = await probe.connectToServer(config.serverName, config)
      if (!connected) {
        return { serverName: config.serverName, tools: [], error: '此服务器需要认证' }
      }
      const tools = probe.connections.find(c => c.server.name === config.serverName)?.server.tools
        ?? await probe.fetchToolsList(config.serverName)
      return { serverName: config.serverName, tools }
    }
    catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        serverName: config.serverName,
        tools: [],
      }
    }
    finally {
      await probe.deleteConnection(config.serverName).catch(() => false)
    }
  }

  @Method()
  async getTestResult(input: AppRpcInput<'mcp.getTestResult'>): Promise<McpServerTestResult> {
    const session = this.testSessions.get(input.attemptId)
    const attempt = this.oauthCoordinator.get(input.attemptId)
    if (!session || !attempt) {
      return { serverName: '', tools: [], error: '测试会话已过期，请重新测试连接' }
    }
    if (session.result) {
      const result = session.result
      await this.disposeTestSession(input.attemptId)
      return result
    }
    if (attempt.status === 'failed' || attempt.status === 'expired' || attempt.status === 'cancelled') {
      const result = { serverName: session.config.serverName, tools: [], error: attempt.error ?? 'OAuth 授权未完成' }
      await this.disposeTestSession(input.attemptId)
      return result
    }
    return { serverName: session.config.serverName, tools: [], oauthRequired: true, attemptId: attempt.id }
  }

  private async connect(
    config: McpConfigSchema,
    configSaved = false,
    allowOAuthPrompt = true,
  ): Promise<McpServerLifecycleResult> {
    this.lifecycleOperations.add(config.serverName)
    try {
      return await this.tryConnect(config, configSaved, false, allowOAuthPrompt)
    }
    finally {
      this.lifecycleOperations.delete(config.serverName)
    }
  }

  /**
   * 单次连接尝试；OAuth 凭据失效时（如 token 过期且 refresh 失败）清除凭据后
   * 重试一次，让 SDK 走完整浏览器授权而不是把 401 当普通连接失败。
   */
  private async tryConnect(
    config: McpConfigSchema,
    configSaved: boolean,
    reauthAttempted: boolean,
    allowOAuthPrompt: boolean,
  ): Promise<McpServerLifecycleResult> {
    const oauthAttempt = config.transportType === 'streamable-http' && config.authType === 'oauth' && this.core.oauthCallbackHost
      ? this.oauthCoordinator.begin({ purpose: 'persistent', serverId: config.serverId })
      : undefined
    if (oauthAttempt)
      this.clientHub.prepareOAuthState(config.serverName, oauthAttempt.state)
    try {
      const connected = await this.clientHub.connectToServer(config.serverName, config)
      if (!connected) {
        const authorizationUrl = this.clientHub.getPendingOAuthUrl(config.serverName)
        if (oauthAttempt && authorizationUrl) {
          if (!allowOAuthPrompt) {
            this.oauthCoordinator.cancel(oauthAttempt.id)
            await this.clientHub.deleteConnection(config.serverName).catch(() => false)
            this.emitStatus(config.serverName, 'disconnected', '需要授权后才能连接，请在 MCP 设置页点击启动重新授权')
            return this.result(config, 'disconnected', '需要授权后才能连接，请在 MCP 设置页点击启动重新授权', configSaved)
          }
          this.oauthCoordinator.markAuthorizationRequired({ attemptId: oauthAttempt.id, authorizationUrl })
          await this.core.oauthCallbackHost!.openAuthorization(authorizationUrl)
        }
        // OAuth 需要授权：连接未完成，等待用户在浏览器中完成授权
        this.emitStatus(config.serverName, 'connecting')
        return this.result(config, 'connecting', 'OAuth authorization required')
      }
      this.emitStatus(config.serverName, 'connected')
      return this.result(config, 'connected')
    }
    catch (error) {
      await this.clientHub.deleteConnection(config.serverName).catch(() => false)
      if (!reauthAttempted && allowOAuthPrompt && isOAuthCredentialFailure(config, error)) {
        await this.clientHub.invalidateOAuthCredentials(config.serverName).catch(() => false)
        return this.tryConnect(config, configSaved, true, true)
      }
      const message = error instanceof Error ? error.message : String(error)
      this.emitStatus(config.serverName, 'disconnected', message)
      return this.result(config, 'disconnected', message, configSaved)
    }
  }

  private async disconnect(config: McpConfigSchema): Promise<McpServerLifecycleResult> {
    this.lifecycleOperations.add(config.serverName)
    try {
      const stopped = await this.clientHub.deleteConnection(config.serverName)
      if (!stopped)
        throw new Error(`停止 MCP server 失败：${config.serverName}`)
      this.emitStatus(config.serverName, 'disconnected')
      return this.result(config, 'disconnected')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emitStatus(config.serverName, 'disconnected', message)
      return this.result(config, 'disconnected', message, false)
    }
    finally {
      this.lifecycleOperations.delete(config.serverName)
    }
  }

  private async finishTestOAuth(attemptId: string, callbackParams: URLSearchParams, callbackError?: string): Promise<void> {
    const session = this.testSessions.get(attemptId)
    if (!session) {
      throw new Error('OAuth 测试会话已过期。')
    }
    if (callbackError) {
      session.result = { serverName: session.config.serverName, tools: [], error: callbackError }
      return
    }
    try {
      const connected = await session.probe.finishOAuthAuth(session.config.serverName, callbackParams)
      if (!connected) {
        throw new Error('OAuth 授权完成后未能建立测试连接。')
      }
      const tools = session.probe.connections.find(connection => connection.server.name === session.config.serverName)?.server.tools
        ?? await session.probe.fetchToolsList(session.config.serverName)
      session.result = { serverName: session.config.serverName, tools }
      this.oauthCoordinator.complete(attemptId)
    }
    catch (error) {
      this.oauthCoordinator.fail(attemptId, error)
      session.result = { serverName: session.config.serverName, tools: [], error: errorMessage(error) }
      throw error
    }
  }

  private async disposeTestSession(attemptId: string): Promise<void> {
    const session = this.testSessions.get(attemptId)
    this.testSessions.delete(attemptId)
    this.oauthCoordinator.dispose(attemptId)
    if (session) {
      await session.probe.deleteConnection(session.config.serverName).catch(() => false)
    }
  }

  private getConnectionStatus(serverName: string): McpServerLifecycleResult['status'] | undefined {
    return this.clientHub.connections.find(connection => connection.server.name === serverName)?.server.status
  }

  private requireConfig(serverName: string): McpConfigSchema {
    const config = this.core.data.mcpSettingsRepository.getMcpConfigByServerName(serverName)
    if (!config)
      throw new Error(`MCP server 不存在：${serverName}`)
    return config
  }

  private emitChanged(serverName: string): void {
    this.core.events.emit('mcp:changed', { serverName })
  }

  private emitStatus(serverName: string, status: McpServer['status'], error?: string): void {
    this.core.events.emit('mcp:status-changed', {
      ...(error ? { error } : {}),
      serverName,
      status,
    })
  }

  private result(
    config: McpConfigSchema,
    status: McpServerLifecycleResult['status'],
    error?: string,
    configSaved?: boolean,
  ): McpServerLifecycleResult {
    return {
      ...(error ? { error } : {}),
      ...(error && configSaved !== undefined ? { configSaved } : {}),
      serverName: config.serverName,
      status,
      transportType: config.transportType,
    }
  }
}

function mergeConfig(current: McpConfigSchema, updates: McpServerEditPatch): McpConfigSchema {
  return McpConfigValidator.parse({ ...current, ...stripUndefined(updates) })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 显式 undefined 的 patch 字段不得覆盖现有配置（例如编辑表单未提交的 enabled）。 */
function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

/** 仅对 OAuth server 且错误明确指向凭据失效时触发重新授权，避免误清网络故障的凭据。 */
function isOAuthCredentialFailure(config: McpConfigSchema, error: unknown): boolean {
  if (!('authType' in config) || config.authType !== 'oauth')
    return false
  const message = error instanceof Error ? error.message : String(error)
  return /unauthorized|401|authentication|invalid grant|expired/i.test(message)
}
