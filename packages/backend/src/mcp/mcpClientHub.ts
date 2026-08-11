import type { ILogger, McpServer, McpTool } from '@ant-chat/shared'
import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
  Tool,
} from '@modelcontextprotocol/client'
import type { McpOAuthCredentialStore } from './oauthCredentialStore'
import process from 'node:process'
import { DEFAULT_MCP_TOOL_NAME_SEPARATOR, McpConfigSchema } from '@ant-chat/shared'
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import deepEqual from 'fast-deep-equal'
import * as packageJson from '../../../../package.json'
import { resolveMcpToolTimeoutMs } from './schema'
import { getCurrentPlatform } from './utils'

export type ITool = Pick<Tool, 'name' | 'description' | 'inputSchema'> & {
  serverName: string
}

export interface McpConnection {
  server: McpServer
  client: Client
  transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport
}

/**
 * MCP OAuth 客户端提供者，管理 OAuth 令牌和客户端凭据的存储与生命周期。
 *
 * 实现 @modelcontextprotocol/client 的 OAuthClientProvider 接口，
 * 支持 DCR（动态客户端注册）和预注册客户端两种模式。
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private readonly credentialsByIssuer = new Map<string, McpOAuthCredential>()
  private currentIssuer: string | undefined
  private currentTokens: StoredOAuthTokens | undefined
  private verifier: string | undefined
  lastState: string | undefined
  /** 最近一次授权的 URL，供调用方获取并在浏览器中打开 */
  lastAuthorizationUrl: string | undefined

  constructor(
    private readonly endpoint: string,
    readonly redirectUrl: string | URL,
    private readonly logger?: ILogger,
    private readonly credentialStore?: McpOAuthCredentialStore,
    private readonly stateFactory?: () => string,
  ) {}

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: packageJson.name,
      redirect_uris: [typeof this.redirectUrl === 'string' ? this.redirectUrl : this.redirectUrl.toString()],
    }
  }

  async clientInformation(ctx?: OAuthClientInformationContext): Promise<StoredOAuthClientInformation | undefined> {
    if (!ctx)
      return undefined
    return (await this.loadCredential(ctx.issuer)).clientInformation
  }

  async saveClientInformation(info: StoredOAuthClientInformation, ctx?: OAuthClientInformationContext): Promise<void> {
    const issuer = ctx?.issuer ?? info.issuer
    if (!issuer)
      throw new Error('OAuth 客户端资料缺少 issuer，拒绝跨授权服务器保存。')
    const credential = await this.loadCredential(issuer)
    credential.clientInformation = info
    await this.saveCredential(issuer, credential)
  }

  async tokens(ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    if (!ctx)
      return this.currentTokens
    const credential = await this.loadCredential(ctx.issuer)
    this.currentIssuer = ctx.issuer
    this.currentTokens = credential.tokens
    return credential.tokens
  }

  async saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext): Promise<void> {
    const issuer = ctx?.issuer ?? tokens.issuer
    if (!issuer)
      throw new Error('OAuth token 缺少 issuer，拒绝跨授权服务器保存。')
    const credential = await this.loadCredential(issuer)
    credential.tokens = tokens
    this.currentIssuer = issuer
    this.currentTokens = tokens
    await this.saveCredential(issuer, credential)
    this.logger?.info('OAuth tokens saved')
  }

  state(): string {
    this.lastState = this.stateFactory?.() ?? crypto.randomUUID()
    return this.lastState
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const issuer = state.authorizationServerMetadata?.issuer ?? state.authorizationServerUrl
    const credential = await this.loadCredential(issuer)
    credential.discoveryState = state
    this.currentIssuer = issuer
    await this.saveCredential(issuer, credential)
    await this.credentialStore?.saveDiscoveryIssuer(this.endpoint, issuer)
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    if (!this.currentIssuer) {
      this.currentIssuer = await this.credentialStore?.loadDiscoveryIssuer(this.endpoint)
    }
    if (!this.currentIssuer)
      return undefined
    const credential = await this.loadCredential(this.currentIssuer)
    return credential.discoveryState
  }

  redirectToAuthorization(url: URL): void {
    const urlStr = url.toString()
    this.lastAuthorizationUrl = urlStr
    this.logger?.info(`OAuth authorization URL: ${urlStr}`)
  }

  saveCodeVerifier(v: string): void {
    this.verifier = v
  }

  codeVerifier(): string {
    if (!this.verifier) {
      throw new Error('no code verifier available')
    }
    return this.verifier
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'verifier') {
      this.verifier = undefined
      return
    }
    if (!this.currentIssuer) {
      this.currentIssuer = await this.credentialStore?.loadDiscoveryIssuer(this.endpoint)
    }
    if (!this.currentIssuer)
      return
    const credential = await this.loadCredential(this.currentIssuer)
    if (scope === 'all') {
      this.credentialsByIssuer.delete(this.currentIssuer)
      this.currentTokens = undefined
      await this.credentialStore?.delete({ endpoint: this.endpoint, issuer: this.currentIssuer })
      await this.credentialStore?.deleteDiscoveryIssuer(this.endpoint)
      return
    }
    if (scope === 'client')
      credential.clientInformation = undefined
    if (scope === 'tokens') {
      credential.tokens = undefined
      this.currentTokens = undefined
    }
    if (scope === 'discovery') {
      credential.discoveryState = undefined
      await this.credentialStore?.deleteDiscoveryIssuer(this.endpoint)
    }
    await this.saveCredential(this.currentIssuer, credential)
  }

  private async loadCredential(issuer: string): Promise<McpOAuthCredential> {
    const cached = this.credentialsByIssuer.get(issuer)
    if (cached)
      return cached
    const stored = await this.credentialStore?.load<McpOAuthCredential>({ endpoint: this.endpoint, issuer })
    const credential = stored ?? {}
    this.credentialsByIssuer.set(issuer, credential)
    return credential
  }

  private async saveCredential(issuer: string, credential: McpOAuthCredential): Promise<void> {
    this.credentialsByIssuer.set(issuer, credential)
    await this.credentialStore?.save({ endpoint: this.endpoint, issuer }, credential)
  }
}

interface McpOAuthCredential {
  clientInformation?: StoredOAuthClientInformation
  discoveryState?: OAuthDiscoveryState
  tokens?: StoredOAuthTokens
}

/**
 * 创建 OAuthClientProvider 用于认证传输层。
 * 始终返回 OAuthClientProvider（不降级为 BearerAuthProvider），
 * 让 SDK 自行管理 token 生命周期：有效直接用、过期自动 refresh、无 token 走完整授权。
 */
function createAuthProvider(
  endpoint: string,
  redirectUrl: string | URL,
  logger?: ILogger,
  existingProvider?: McpOAuthProvider,
  credentialStore?: McpOAuthCredentialStore,
  stateFactory?: () => string,
): { provider: OAuthClientProvider, oauthProvider: McpOAuthProvider } {
  const oauthProvider = existingProvider ?? new McpOAuthProvider(endpoint, redirectUrl, logger, credentialStore, stateFactory)
  return { provider: oauthProvider, oauthProvider }
}

/**
 * 这个类的实现参考自：https://github.com/cline/cline/blob/main/src/services/mcp/McpHub.ts
 */
/** 已保存 MCP server 的连接注册 Module；不拥有 OAuth callback 路由或凭据存储。 */
export class McpConnectionManager {
  isInitializing = false
  connections: McpConnection[] = []
  isWin32 = getCurrentPlatform() === 'win32'
  private onErrorCallbacks: ((name: string, e: Error) => void)[] = []
  private onStatusChangeCallbacks: ((name: string, status: McpServer['status']) => void)[] = []
  /** 每个 server 对应的 OAuth provider，用于跨多次 connect 保持认证状态 */
  private oauthProviders = new Map<string, McpOAuthProvider>()
  /** OAuth 回调地址，由宿主（Electron 主进程）启动 localhost 服务器后设置 */
  private oAuthRedirectUrl: string | undefined
  private readonly oauthStateByServerName = new Map<string, string>()
  /** 正在主动关闭的连接（dispose/删除/替换），其 onclose 属于预期行为，不应记为错误 */
  private readonly closingConnections = new Set<string>()

  constructor(
    private readonly logger?: ILogger,
    oAuthRedirectUrl?: string,
    private readonly oauthCredentialStore?: McpOAuthCredentialStore,
  ) {
    this.oAuthRedirectUrl = oAuthRedirectUrl
  }

  /** 设置 OAuth 回调地址。宿主应在启动 localhost 回调服务器后调用此方法。 */
  setOAuthRedirectUrl(url: string): void {
    this.oAuthRedirectUrl = url
  }

  /** 获取当前 OAuth 回调地址。 */
  getOAuthRedirectUrl(): string | undefined {
    return this.oAuthRedirectUrl
  }

  /** OAuthCoordinator 在开始授权前注入唯一 state；连接完成或删除后即清理。 */
  prepareOAuthState(serverName: string, state: string): void {
    this.oauthStateByServerName.set(serverName, state)
  }

  addErrorCallback(callback: (name: string, e: Error) => void) {
    if (typeof callback === 'function') {
      this.onErrorCallbacks.push(callback)
    }
  }

  removeErrorCallback(callback: (name: string, e: Error) => void) {
    const index = this.onErrorCallbacks.findIndex(func => func === callback)
    if (index > -1) {
      this.onErrorCallbacks.splice(index, 1)
    }
  }

  addStatusChangeCallback(callback: (name: string, status: McpServer['status']) => void) {
    this.onStatusChangeCallbacks.push(callback)
  }

  async initializeMcpServers(mcpServers: McpConfigSchema[]): Promise<void> {
    this.isInitializing = true
    await this.updateServerConnections(mcpServers)
    this.isInitializing = false
  }

  async updateServerConnections(newServers: McpConfigSchema[]): Promise<void> {
    const currentNames = new Set(this.connections.map(conn => conn.server.name))
    const newNames = new Set(newServers.map(item => item.serverName))

    // 删除已移除的 server
    for (const name of currentNames) {
      if (!newNames.has(name)) {
        await this.deleteConnection(name)
        this.oauthProviders.delete(name)
        this.logger?.info(`Deleted MCP server: ${name}`)
      }
    }

    // 更新或新增 server
    for (const config of newServers) {
      const { serverName: name } = config
      const currentConnection = this.connections.find(conn => conn.server.name === name)

      if (!currentConnection) {
        // 新 server
        try {
          await this.connectToServer(name, config)
        }
        catch (error) {
          this.logger?.error(`Failed to connect to new MCP server ${name}:`, error)
        }
      }
      else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
        // 配置变更的 server
        try {
          await this.deleteConnection(name)
          // 配置变更时重置 OAuth provider
          this.oauthProviders.delete(name)
          await this.connectToServer(name, config)
          this.logger?.info(`Reconnected MCP server with updated config: ${name}`)
        }
        catch (error) {
          this.logger?.error(`Failed to reconnect MCP server ${name}:`, error)
        }
      }
    }
  }

  async connectToServer(name: string, config: McpConfigSchema) {
    this.connections = this.connections.filter(conn => conn.server.name !== name)

    const client = new Client({
      name: packageJson.name,
      version: packageJson.version,
    })

    let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

    if (config.transportType === 'streamable-http') {
      const httpOptions: Record<string, unknown> = {
        requestInit: {
          headers: config.headers,
        },
      }

      // OAuth 认证配置
      if (config.authType === 'oauth' && this.oAuthRedirectUrl) {
        const existingProvider = this.oauthProviders.get(name)
        const authSetup = createAuthProvider(
          config.url,
          this.oAuthRedirectUrl,
          this.logger,
          existingProvider,
          this.oauthCredentialStore,
          () => this.oauthStateByServerName.get(name) ?? crypto.randomUUID(),
        )
        httpOptions.authProvider = authSetup.provider
        this.oauthProviders.set(name, authSetup.oauthProvider)
      }

      // 优先使用 Streamable HTTP（v2 新协议），失败时回退 SSE（旧协议）
      transport = new StreamableHTTPClientTransport(new URL(config.url), httpOptions as never)
    }
    else {
      // StdioClientTransport 以 shell:false 直接 spawn(command, args)，
      // command 必须是可执行文件路径。含空白说明参数被拼进了 command
      // （常见于直接粘贴 Claude Desktop 的整串命令格式），此时 spawn 必然
      // ENOENT；提前抛出可读错误，避免用户面对不可操作的进程级报错。
      if (/\s/.test(config.command)) {
        throw new Error(`command 只允许填可执行文件（如 npx/uv/docker），参数请填写到 args；当前 command 包含空格："${config.command}"`)
      }
      // args 是逐参数数组，shell:false 下不会做分词。单个元素含空格说明
      // 用户把多个参数拼成了一串（如 "npx -y pkg <url>" 被整体塞进一个
      // args 元素），直接传给 npm 等会产生不可读的 config 解析错误。
      const malformedArg = (config.args ?? []).find(arg => /\s/.test(arg))
      if (malformedArg !== undefined) {
        throw new Error(`args 参数 "${malformedArg}" 包含空格，请将每个参数分开填写（空格分隔的参数请用引号包裹）；可在 MCP 设置页重新保存该服务器自动修正`)
      }
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: {
          ...config.env,
          PATH: mergePathEnv(config?.env?.path || config?.env?.PATH || ''),
        },
      })
    }

    // 设置传输层错误回调
    transport.onerror = async (error: Error) => {
      this.logger?.error(`Transport error for "${name}":`, error)
      this.onErrorCallbacks.forEach((func) => {
        func(name, error)
      })
      const connection = this.connections.find(conn => conn.server.name === name)
      if (connection) {
        connection.server.status = 'disconnected'
        this.emitStatusChange(name, 'disconnected')
      }
    }

    transport.onclose = async () => {
      if (this.closingConnections.has(name)) {
        // 主动关闭（deleteConnection / 应用退出 dispose），不是传输错误
        this.logger?.info(`Transport closed for "${name}" (主动关闭)`)
      }
      else {
        this.logger?.error(`Transport closed for "${name}".`)
      }
      const connection = this.connections.find(conn => conn.server.name === name)
      if (connection) {
        connection.server.status = 'disconnected'
        this.emitStatusChange(name, 'disconnected')
      }
    }

    const connection: McpConnection = {
      server: {
        name,
        config: JSON.stringify(config),
        status: 'connecting',
      },
      client,
      transport,
    }

    this.connections.push(connection)

    // 尝试连接，处理 OAuth 未授权错误
    try {
      await connection.client.connect(transport)
    }
    catch (error) {
      if (error instanceof UnauthorizedError) {
        // OAuth 授权流程：传输层已调用 provider.redirectToAuthorization(url)
        // 用户需要在浏览器中完成授权，之后调用 finishAuth 完成流程
        this.logger?.info(`OAuth authorization required for "${name}"`)
        connection.server.status = 'connecting'
        connection.server.error = 'OAuth authorization required'
        this.emitStatusChange(name, 'connecting')
        return false
      }
      throw error
    }

    connection.server.status = 'connected'
    connection.server.error = ''
    this.emitStatusChange(name, 'connected')

    // 获取 tools 列表
    connection.server.tools = (await this.fetchToolsList(name)) || []

    return true
  }

  /**
   * 获取指定 server 待授权的 OAuth URL。
   * 当 connectToServer 因 UnauthorizedError 中断后，可通过此方法获取需要在浏览器中打开的授权 URL。
   * 返回 undefined 表示没有待处理的 OAuth 授权。
   */
  getPendingOAuthUrl(name: string): string | undefined {
    const provider = this.oauthProviders.get(name)
    if (!provider) {
      return undefined
    }
    return provider.lastAuthorizationUrl
  }

  /**
   * 完成 OAuth 授权流程。
   *
   * 当 connectToServer 因 UnauthorizedError 中断后，
   * 用户在浏览器中完成授权，回调 URL 携带 code 和 state 参数。
   * 调用此方法完成 token 交换，然后重新连接。
   */
  async finishOAuthAuth(name: string, callbackParams: URLSearchParams): Promise<boolean> {
    const connection = this.connections.find(conn => conn.server.name === name)
    if (!connection) {
      throw new Error(`MCP server "${name}" not found.`)
    }

    const transport = connection.transport
    if (!(transport instanceof SSEClientTransport) && !(transport instanceof StreamableHTTPClientTransport)) {
      throw new TypeError(`Transport for "${name}" does not support OAuth.`)
    }

    try {
      await transport.finishAuth(callbackParams)
      this.logger?.info(`OAuth authorization completed for "${name}"`)

      // 重新连接
      await connection.client.close()
      const config = JSON.parse(connection.server.config) as McpConfigSchema
      return await this.connectToServer(name, config)
    }
    catch (error) {
      this.logger?.error(`OAuth authorization failed for "${name}":`, error)
      throw error
    }
  }

  async fetchToolsList(name: string) {
    try {
      const connect = this.connections.find(item => item.server.name === name)
      if (!connect) {
        throw new Error(`MCP server "${name}" not found.`)
      }

      // v2 API: 使用 client.listTools() 替代 client.request({method: 'tools/list'}, ...)
      const response = await connect.client.listTools()

      return (response.tools || []).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object' as const,
          properties: (tool.inputSchema.properties || {}) as Record<string, Record<string, unknown>>,
          required: tool.inputSchema.required as string[],
        },
      })) as McpTool[]
    }
    catch {
      return []
    }
  }

  /** 清除指定 server 的 OAuth 凭据（Keychain 与内存），下次连接会重新发起授权。 */
  async invalidateOAuthCredentials(name: string): Promise<void> {
    const provider = this.oauthProviders.get(name)
    if (!provider)
      return
    await provider.invalidateCredentials('all')
    this.oauthProviders.delete(name)
  }

  getAllAvailableToolsList(): McpTool[] {
    const tools: McpTool[] = []
    this.connections.filter(item => item.server.status === 'connected').forEach((item) => {
      if (item.server.tools) {
        tools.push(
          ...item.server.tools.map((tool) => {
            const { name, description, inputSchema } = tool
            return {
              name: `${item.server.name}${DEFAULT_MCP_TOOL_NAME_SEPARATOR}${name}`,
              description,
              inputSchema,
            }
          }),
        )
      }
    })

    return tools
  }

  async callTool(serverName: string, toolName: string, toolArguments?: Record<string, unknown>) {
    const connection = this.connections.find(conn => conn.server.name === serverName)
    if (!connection) {
      throw new Error(
        `No connection found for server: ${serverName}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`,
      )
    }

    if (connection.server.disabled) {
      throw new Error(`Server "${serverName}" is disabled and cannot be used`)
    }

    let timeoutSeconds: number | undefined

    try {
      const config = JSON.parse(connection.server.config)
      const parsedConfig = McpConfigSchema.parse(config)
      timeoutSeconds = parsedConfig?.timeout
    }
    catch (error) {
      this.logger?.error(`Failed to parse timeout configuration for server ${serverName}:`, error)
    }

    // 解析失败时回退到默认 10 秒；秒到毫秒只在此处转换一次
    const timeout = resolveMcpToolTimeoutMs(timeoutSeconds)

    // v2 API: 使用 client.callTool() 替代 client.request({method: 'tools/call'}, ...)
    const result = await connection.client.callTool(
      {
        name: toolName,
        arguments: toolArguments,
      },
      {
        timeout,
      } as never,
    )

    return {
      ...result,
      content: result.content ?? [],
    }
  }

  async deleteConnection(name: string) {
    this.oauthStateByServerName.delete(name)
    const index = this.connections.findIndex(item => item.server.name === name)
    if (index !== -1) {
      const connection = this.connections[index]
      this.connections.splice(index, 1)

      // 标记主动关闭，onclose 回调据此降级日志级别
      this.closingConnections.add(name)
      try {
        await connection.transport.close()
        await connection.client.close()
        this.emitStatusChange(name, 'disconnected')
      }
      catch (error) {
        this.logger?.error(`Failed to close transport for ${name}:`, error)
        return false
      }
      finally {
        this.closingConnections.delete(name)
      }
    }

    return true
  }

  private emitStatusChange(name: string, status: McpServer['status']): void {
    for (const callback of this.onStatusChangeCallbacks)
      callback(name, status)
  }
}

function mergePathEnv(path: string) {
  const isWin32 = getCurrentPlatform() === 'win32'
  const delimiter = isWin32 ? ';' : ':'
  const builtInPath = process.env.Path || process.env.PATH || ''

  return `${builtInPath}${delimiter}${path}`
}
