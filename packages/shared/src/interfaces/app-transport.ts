import type { IpcPaginatedResponse, IpcResponse } from '../ipc-events'
import type {
  AddConversationsSchema,
  AddMcpConfigSchema,
  AddServiceProviderModelSchema,
  AddServiceProviderSchema,
  AllAvailableModelsSchema,
  McpConfigSchema,
  ServiceProviderModelsSchema,
  ServiceProviderSchema,
  UpdateConversationsSchema,
  UpdateMcpConfigSchema,
  UpdateServiceProviderSchema,
} from '../schemas'
import type { AgentProfileFiles, UpdateAgentProfileInput } from './agent-profile'
import type {
  AgentTaskSnapshot,
  ApprovePendingActionOptions,
  CancelTaskOptions,
  RejectPendingActionOptions,
} from './agent-runtime'
import type { AgentTurnResult, StartAgentTurnOptions } from './agent-runtime-electron'
import type { handleInitConversationTitleOptions } from './conversation-title'
import type { IConversations, IMessage } from './db-types'
import type { GeneralSettingsState } from './generalSettings'
import type { SearchResult } from './global-search'
import type {
  McpConnection,
  McpTool,
  McpToolCallResponse,
} from './mcp'
import type {
  ModelsDevImportResult,
  ModelsDevModel,
  ModelsDevProvider,
} from './modelsDev'
import type {
  ImportSkillFromGithubOptions,
  SetSkillEnabledOptions,
  SkillIndex,
  SkillManifest,
} from './skill'
import type { UpdateConfig, UpdateInfo, UpdateStatus } from './update'
import type { ListWorkspacesData, WorkspaceFileSearchResult } from './workspace'

export interface AppTransport {
  capabilities: {
    workspacePicker: boolean
  }
  chat: {
    createConversationsTitle: (options: handleInitConversationTitleOptions) => Promise<IpcResponse<IConversations>>
    getConversations: (pageIndex: number, pageSize: number) => Promise<{ data: IConversations[], total: number }>
    getWorkspaceConversations: (workspacePath: string, pageIndex: number, pageSize: number) => Promise<{ data: IConversations[], total: number }>
    getConversationById: (id: string) => Promise<IConversations>
    addConversation: (conversation: AddConversationsSchema) => Promise<IConversations>
    updateConversation: (conversation: UpdateConversationsSchema) => Promise<IConversations>
    deleteConversation: (id: string) => Promise<null>
    getMessagesByConvId: (convId: string) => Promise<IMessage[]>
    getMessageById: (id: string) => Promise<IMessage>
    addMessage: (message: IMessage) => Promise<IMessage>
    updateMessage: (message: IMessage) => Promise<IMessage>
    deleteMessage: (id: string) => Promise<null>
    getMessagesByConvIdWithPagination: (id: string, pageIndex: number, pageSize: number) => Promise<{ data: IMessage[], total: number }>
    batchDeleteMessages: (ids: string[]) => Promise<null>
  }
  settings: {
    getSettings: () => Promise<GeneralSettingsState>
    updateSettings: (updates: Partial<GeneralSettingsState>) => Promise<GeneralSettingsState>
    resetSettings: () => Promise<GeneralSettingsState>
  }
  provider: {
    getAllProviderServices: () => Promise<ServiceProviderSchema[]>
    addProviderService: (config: AddServiceProviderSchema) => Promise<ServiceProviderSchema>
    updateProviderService: (config: UpdateServiceProviderSchema) => Promise<ServiceProviderSchema>
    deleteProviderService: (id: string) => Promise<null>
    getProviderServiceById: (id: string) => Promise<ServiceProviderSchema>
    getProviderServiceByModelId: (id: string) => Promise<ServiceProviderSchema>
    getAllAbvailableModels: () => Promise<AllAvailableModelsSchema[]>
    getModelsByServiceProviderId: (id: string) => Promise<ServiceProviderModelsSchema[]>
    setModelEnabledStatus: (id: string, status: boolean) => Promise<ServiceProviderModelsSchema>
    addServiceProviderModel: (config: AddServiceProviderModelSchema) => Promise<ServiceProviderModelsSchema>
    deleteServiceProviderModel: (id: string) => Promise<null>
    getModelInfoById: (id: string) => Promise<ServiceProviderModelsSchema>
    getModelsDevProviders: () => Promise<ModelsDevProvider[]>
    getModelsDevModelsByProviderId: (providerId: string) => Promise<ModelsDevModel[]>
    importModelsDevModels: (providerId: string) => Promise<ModelsDevImportResult>
  }
  skills: {
    listSkills: () => Promise<SkillIndex>
    importSkillFromZip: () => Promise<SkillManifest | null>
    importSkillFromGithub: (options: ImportSkillFromGithubOptions) => Promise<SkillManifest>
    setSkillEnabled: (options: SetSkillEnabledOptions) => Promise<SkillManifest>
    deleteSkill: (name: string) => Promise<null>
    rebuildSkillIndex: () => Promise<SkillIndex>
  }
  profile: {
    getProfile: () => Promise<AgentProfileFiles>
    updateProfile: (input: UpdateAgentProfileInput) => Promise<AgentProfileFiles>
    rollbackSoul: () => Promise<AgentProfileFiles>
  }
  agent: {
    startTurn: (options: StartAgentTurnOptions) => Promise<AgentTurnResult>
    approvePendingAction: (options: ApprovePendingActionOptions) => Promise<null>
    rejectPendingAction: (options: RejectPendingActionOptions) => Promise<null>
    cancelTask: (taskId: string) => Promise<null>
    injectSteering: (params: { conversationId: string, text: string }) => Promise<null>
    listActiveTasks: (conversationId?: string) => Promise<AgentTaskSnapshot[]>
    approvePendingActionWithWhitelist: (options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string }) => Promise<null>
  }
  workspace: {
    listWorkspaces: () => Promise<ListWorkspacesData>
    addWorkspace: (path: string) => Promise<ListWorkspacesData>
    removeWorkspace: (path: string) => Promise<ListWorkspacesData>
    openWorkspace: (path: string) => Promise<ListWorkspacesData>
    chooseWorkspace?: () => Promise<ListWorkspacesData | null>
    searchWorkspaceFiles: (query: string, limit?: number) => Promise<WorkspaceFileSearchResult[]>
  }
}

export interface AppIpcServices {
  app: {
    clipboardWrite: (...args: unknown[]) => Promise<boolean>
    minimizeWindow: () => Promise<void>
    maximizeOrRestoreWindow: () => Promise<void>
    quitApp: () => Promise<void>
  }
  agent: {
    startTurn: (options: StartAgentTurnOptions) => Promise<IpcResponse<AgentTurnResult>>
    approvePendingAction: (options: ApprovePendingActionOptions) => Promise<IpcResponse<null>>
    rejectPendingAction: (options: RejectPendingActionOptions) => Promise<IpcResponse<null>>
    cancelTask: (options: CancelTaskOptions) => Promise<IpcResponse<null>>
    getTask: (taskId: string) => Promise<IpcResponse<AgentTaskSnapshot>>
    listActiveTasks: (conversationId?: string) => Promise<IpcResponse<AgentTaskSnapshot[]>>
    injectSteering: (params: { conversationId: string, text: string }) => Promise<IpcResponse<null>>
    approvePendingActionWithWhitelist: (options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string }) => Promise<IpcResponse<null>>
  }
  chat: {
    createConversationsTitle: (options: handleInitConversationTitleOptions) => Promise<IpcResponse<IConversations>>
    getConversations: (pageIndex: number, pageSize: number) => Promise<IpcPaginatedResponse<IConversations[]>>
    getWorkspaceConversations: (workspacePath: string, pageIndex: number, pageSize: number) => Promise<IpcPaginatedResponse<IConversations[]>>
    getConversationById: (id: string) => Promise<IpcResponse<IConversations>>
    addConversation: (conversation: AddConversationsSchema) => Promise<IpcResponse<IConversations>>
    updateConversation: (conversation: UpdateConversationsSchema) => Promise<IpcResponse<IConversations>>
    deleteConversation: (id: string) => Promise<IpcResponse<null>>
    getMessagesByConvId: (id: string) => Promise<IpcResponse<IMessage[]>>
    getMessageById: (id: string) => Promise<IpcResponse<IMessage>>
    addMessage: (message: IMessage) => Promise<IpcResponse<IMessage>>
    updateMessage: (message: IMessage) => Promise<IpcResponse<IMessage>>
    deleteMessage: (id: string) => Promise<IpcResponse<null>>
    getMessagesByConvIdWithPagination: (id: string, pageIndex: number, pageSize: number) => Promise<IpcPaginatedResponse<IMessage[]>>
    batchDeleteMessages: (ids: string[]) => Promise<IpcResponse<null>>
  }
  mcp: {
    getConfigs: () => Promise<IpcResponse<McpConfigSchema[]>>
    getConfigByServerName: (serverName: string) => Promise<IpcResponse<McpConfigSchema>>
    addConfig: (config: AddMcpConfigSchema) => Promise<IpcResponse<McpConfigSchema>>
    updateConfig: (config: UpdateMcpConfigSchema) => Promise<IpcResponse<McpConfigSchema>>
    deleteConfig: (serverName: string) => Promise<IpcResponse<null>>
    getConnections: () => Promise<IpcResponse<McpConnection[]>>
    getAllAvailableToolsList: () => Promise<IpcResponse<McpTool[]>>
    callTool: (serverName: string, toolName: string, toolArguments?: Record<string, unknown>) => Promise<IpcResponse<McpToolCallResponse>>
    connectMcpServer: (name: string, mcpConfig: McpConfigSchema) => Promise<IpcResponse<null>>
    disconnectMcpServer: (name: string) => Promise<IpcResponse<null>>
    reconnectMcpServer: (name: string, mcpConfig: McpConfigSchema) => Promise<IpcResponse<null>>
    fetchMcpServerTools: (name: string) => Promise<IpcResponse<McpTool[]>>
    initializeMcpServers: () => Promise<IpcResponse<null>>
  }
  profile: {
    getProfile: () => Promise<IpcResponse<AgentProfileFiles>>
    updateProfile: (input: UpdateAgentProfileInput) => Promise<IpcResponse<AgentProfileFiles>>
    rollbackSoul: () => Promise<IpcResponse<AgentProfileFiles>>
  }
  provider: {
    getAllProviderServices: () => Promise<IpcResponse<ServiceProviderSchema[]>>
    addProviderServices: (data: AddServiceProviderSchema) => Promise<IpcResponse<ServiceProviderSchema>>
    updateProviderService: (serviceData: UpdateServiceProviderSchema) => Promise<IpcResponse<ServiceProviderSchema>>
    deleteProviderService: (id: string) => Promise<IpcResponse<null>>
    getProviderServicesById: (id: string) => Promise<IpcResponse<ServiceProviderSchema>>
    getProviderServiceByModelId: (id: string) => Promise<IpcResponse<ServiceProviderSchema>>
    getAllAbvailableModels: () => Promise<IpcResponse<AllAvailableModelsSchema[]>>
    getModelsByServiceProviderId: (id: string) => Promise<IpcResponse<ServiceProviderModelsSchema[]>>
    getModelById: (id: string) => Promise<IpcResponse<ServiceProviderModelsSchema>>
    setModelEnabledStatus: (id: string, status: boolean) => Promise<IpcResponse<ServiceProviderModelsSchema>>
    addProviderServiceModel: (config: AddServiceProviderModelSchema) => Promise<IpcResponse<ServiceProviderModelsSchema>>
    deleteProviderServiceModel: (id: string) => Promise<IpcResponse<null>>
    getModelsDevProviders: () => Promise<IpcResponse<ModelsDevProvider[]>>
    getModelsDevModelsByProviderId: (providerId: string) => Promise<IpcResponse<ModelsDevModel[]>>
    importModelsDevModels: (providerId: string) => Promise<IpcResponse<ModelsDevImportResult>>
  }
  search: {
    searchByKeyword: (query: string) => Promise<IpcResponse<SearchResult[]>>
  }
  settings: {
    openSettingsWindow: () => Promise<IpcResponse<void>>
    getSettings: () => Promise<IpcResponse<GeneralSettingsState>>
    updateSettings: (updates: Partial<GeneralSettingsState>) => Promise<IpcResponse<GeneralSettingsState>>
    resetSettings: () => Promise<IpcResponse<GeneralSettingsState>>
    testProxyConnection: (proxyUrl: string) => Promise<IpcResponse<boolean>>
  }
  skills: {
    listSkills: () => Promise<IpcResponse<SkillIndex>>
    importSkillFromZip: () => Promise<IpcResponse<SkillManifest | null>>
    importSkillFromGithub: (options: ImportSkillFromGithubOptions) => Promise<IpcResponse<SkillManifest>>
    setSkillEnabled: (options: SetSkillEnabledOptions) => Promise<IpcResponse<SkillManifest>>
    deleteSkill: (name: string) => Promise<IpcResponse<null>>
    rebuildSkillIndex: () => Promise<IpcResponse<SkillIndex>>
  }
  update: {
    getCurrentVersion: () => Promise<IpcResponse<string>>
    checkForUpdatesManual: () => Promise<IpcResponse<UpdateInfo | null>>
    getUpdateConfig: () => Promise<IpcResponse<UpdateConfig>>
    setUpdateConfig: (config: UpdateConfig) => Promise<IpcResponse<UpdateConfig>>
    downloadUpdate: () => Promise<IpcResponse<null>>
    getUpdateStatus: () => Promise<IpcResponse<UpdateStatus>>
    checkForUpdates: () => Promise<void>
    quitAndInstall: () => Promise<void>
    cancelDownload: () => Promise<void>
  }
  workspace: {
    listWorkspaces: () => Promise<IpcResponse<ListWorkspacesData>>
    addWorkspace: (path: string) => Promise<IpcResponse<ListWorkspacesData>>
    removeWorkspace: (path: string) => Promise<IpcResponse<ListWorkspacesData>>
    openWorkspace: (path: string) => Promise<IpcResponse<ListWorkspacesData>>
    chooseWorkspace: () => Promise<IpcResponse<ListWorkspacesData | null>>
    searchWorkspaceFiles: (query?: string, limit?: number) => Promise<IpcResponse<WorkspaceFileSearchResult[]>>
  }
}
