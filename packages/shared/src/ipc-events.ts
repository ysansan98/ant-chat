import type { GeneralSettingsState, handleChatCompletionsOptions, handleInitConversationTitleOptions, IConversations, IMessage, McpServer, McpTool, McpToolCallResponse, NotificationOption, ProgressInfo, SearchResult, UpdateConfig, UpdateError, UpdateInfo, UpdateStatus } from './interfaces'
import type { AddConversationsSchema, AddMcpConfigSchema, AddServiceProviderModelSchema, AddServiceProviderSchema, AllAvailableModelsSchema, McpConfigSchema, ServiceProviderModelsSchema, ServiceProviderSchema, UpdateConversationsSchema, UpdateMcpConfigSchema, UpdateServiceProviderSchema } from './schemas'

export function createIpcResponse<T>(success: boolean, data: T, msg?: string): IpcResponse<T> | ErrorIpcResponse {
  if (success) {
    return { success, data }
  }

  return {
    success,
    msg: msg ?? '',
  }
}

export function createIpcPaginatedResponse<T>(success: boolean, data: T, msg?: string, total?: number): IpcPaginatedResponse<T> {
  if (success) {
    return { success, data, total: total ?? 0 }
  }

  return {
    success,
    msg: msg ?? '',
  }
}

export function createErrorIpcResponse(errMsg: string | Error): ErrorIpcResponse {
  return { success: false, msg: typeof errMsg === 'string' ? errMsg : errMsg.message }
}

interface IpcResponseSuccess<T> {
  success: true
  data: T
}

interface IpcPaginatedResponseSuccess<T> extends IpcResponseSuccess<T> {
  total: number
}

export interface ErrorIpcResponse {
  success: false
  msg: string
}

/**
 * @see https://www.electronjs.org/docs/latest/api/clipboard#clipboardwrite-text
 */
export interface ElectronData {
  text?: string
  html?: string
  image?: any
  rtf?: string
  /**
   * The title of the URL at `text`.
   */
  bookmark?: string
}

export type IpcResponse<T> = IpcResponseSuccess<T> | ErrorIpcResponse

export type IpcPaginatedResponse<T> = IpcPaginatedResponseSuccess<T> | ErrorIpcResponse

// Main process ipc events
export type IpcEvents
  = | {
    /**
     *  这里是定义的是在渲染进程使用
     * @example
     * const emitter = new IpcEmitter<IpcEvents>()
     * emitter.send('ping', 'pong')
     */
    'chat:send-chat-completions': [handleChatCompletionsOptions]
    'chat:cancel-chat-completions': [string]
    'common:minimize-window': []
    'common:maximize-or-resore-window': []
    'common:quit-app': []
    'update:check-for-updates': []
    'update:quit-and-install': []
    'update:cancel-download': []
  }
  | {
    /**
     * 这里是使用invoke相关的事件
     */

    // ============================ 全局 相关 ============================
    'common:clipboard-write': (data: ElectronData, type?: 'selection' | 'clipboard') => Promise<boolean>

    // ============================ Conversaations 相关 ============================
    'db:get-conversations': (pageIndex: number, pageSize: number) => Promise<IpcPaginatedResponse<IConversations[]>>
    'db:conversations-is-exists': (id: string) => Promise<IpcResponse<null>>
    'db:get-conversation-by-id': (id: string) => Promise<IpcResponse<IConversations>>
    'db:add-conversation': (conversations: AddConversationsSchema) => Promise<IpcResponse<IConversations>>
    'db:update-conversation': (conversations: UpdateConversationsSchema) => Promise<IpcResponse<IConversations>>
    'db:delete-conversation': (id: string) => Promise<IpcResponse<null>>

    // ============================ Message 相关 ============================
    'db:get-message-by-id': (id: string) => Promise<IpcResponse<IMessage>>
    'db:get-message-by-convid': (id: string) => Promise<IpcResponse<IMessage[]>>
    'db:delete-message': (id: string) => Promise<IpcResponse<null>>
    'db:add-message': (conversations: Omit<Partial<IMessage>, 'id'>) => Promise<IpcResponse<IMessage>>
    'db:update-message': (conversations: UpdateConversationsSchema) => Promise<IpcResponse<IMessage>>
    'db:get-messages-by-conv-id-with-pagination': (id: string, pageIndex: number, pageSize: number) => Promise<IpcPaginatedResponse<IMessage[]>>
    'db:batch-delete-messages': (ids: string[]) => Promise<IpcResponse<null>>

    // ============================ MCP Server 相关 ============================
    'db:get-mcp-configs': () => Promise<IpcResponse<McpConfigSchema[]>>
    'db:add-mcp-config': (config: AddMcpConfigSchema) => Promise<IpcResponse<McpConfigSchema>>
    'db:update-mcp-config': (config: UpdateMcpConfigSchema) => Promise<IpcResponse<McpConfigSchema>>
    'db:delete-mcp-config': (name: string) => Promise<IpcResponse<null>>
    'db:get-mcp-config-by-server-name': (name: string) => Promise<IpcResponse<McpConfigSchema>>
    'mcp:get-connections': () => Promise<IpcResponse<Pick<McpServer, 'name' | 'config' | 'tools' | 'status'>[]>>
    'mcp:get-all-available-tools-list': () => Promise<IpcResponse<McpTool[]>>
    'mcp:call-tool': (serverName: string, toolName: string, toolArguments?: Record<string, unknown>) => Promise<IpcResponse<McpToolCallResponse>>
    'mcp:connect-mcp-server': (name: string, mcpConfig: McpConfigSchema) => Promise<IpcResponse<null>>
    'mcp:disconnect-mcp-server': (name: string) => Promise<IpcResponse<null>>
    'mcp:reconnect-mcp-server': (name: string, mcpConfig: McpConfigSchema) => Promise<IpcResponse<null>>
    'mcp:fetch-mcp-server-tools': (name: string) => Promise<IpcResponse<McpTool[]>>
    'mcp:mcpToggle': (isEnable: boolean, mcpConfig?: McpConfigSchema[]) => Promise<IpcResponse<null>>

    // ============================ AI服务商相关 ============================
    'db:get-all-provider-services': () => Promise<IpcResponse<ServiceProviderSchema[]>>
    'db:update-provider-service': (data: UpdateServiceProviderSchema) => Promise<IpcResponse<ServiceProviderSchema>>
    'db:add-provider-services': (data: AddServiceProviderSchema) => Promise<IpcResponse<ServiceProviderSchema>>
    'db:delete-provider-service': (id: string) => Promise<IpcResponse<null>>
    'db:get-provider-services-by-id': (id: string) => Promise<IpcResponse<ServiceProviderSchema>>

    // ============================ 模型相关 ============================
    'db:get-all-abvailable-models': () => Promise<IpcResponse<AllAvailableModelsSchema[]>>
    'db:get-models-by-provider-service-id': (id: string) => Promise<IpcResponse<ServiceProviderModelsSchema[]>>
    'db:get-model-by-id': (id: string) => Promise<IpcResponse<ServiceProviderModelsSchema>>
    'db:get-provider-service-by-model-id': (id: string) => Promise<IpcResponse<ServiceProviderSchema>>
    'db:set-model-enabled-status': (id: string, status: boolean) => Promise<IpcResponse<ServiceProviderModelsSchema>>
    'db:add-provider-service-model': (data: AddServiceProviderModelSchema) => Promise<IpcResponse<ServiceProviderModelsSchema>>
    'db:delete-provider-service-model': (id: string) => Promise<IpcResponse<null>>

    'db:delete-model': (id: string) => Promise<IpcResponse<null>>
    'db:add-model': (model: any) => Promise<IpcResponse<null>>

    // ============================ 对话相关 ============================
    'chat:create-conversations-title': (options: handleInitConversationTitleOptions) => Promise<IpcResponse<IConversations>>

    // ============================ 搜索相关 ============================
    'db:search-by-keyword': (query: string) => Promise<IpcResponse<SearchResult[]>>

    // ============================ General Settings 相关 ============================
    'general-settings:get-settings': () => Promise<IpcResponse<GeneralSettingsState>>
    'general-settings:update-settings': (updates: Partial<GeneralSettingsState>) => Promise<IpcResponse<GeneralSettingsState>>
    'general-settings:reset-settings': () => Promise<IpcResponse<GeneralSettingsState>>

    // ============================ 代理相关 ============================
    'proxy:test-connection': (proxyUrl: string) => Promise<IpcResponse<boolean>>

    // ============================ 更新相关 ============================
    'update:get-current-version': () => Promise<IpcResponse<string>>
    'update:check-for-updates-manual': () => Promise<IpcResponse<UpdateInfo | null>>
    'update:get-update-config': () => Promise<IpcResponse<UpdateConfig>>
    'update:set-update-config': (config: UpdateConfig) => Promise<IpcResponse<UpdateConfig>>
    'update:download-update': () => Promise<IpcResponse<null>>
    'update:get-update-status': () => Promise<IpcResponse<UpdateStatus>>
  }

/**
 * 这里是在渲染进程中接收的事件
 */
export interface IpcRendererEvent {
  'mcp:McpServerStatusChanged': [string, 'disconnected' | 'connected']
  'common:Notification': [NotificationOption]
  'chat:stream-message': [IMessage]
  'chat:stream-canceled': [string]
  'update:update-status-changed': [{ status: UpdateStatus, updateInfo: UpdateInfo | null }]
  'update:update-available': [{ status: UpdateStatus, updateInfo: UpdateInfo | null }]
  'update:update-not-available': []
  'update:download-progress': [ProgressInfo]
  'update:update-downloaded': [UpdateInfo]
  'update:update-error': [UpdateError]
  [key: string]: unknown[]
}
