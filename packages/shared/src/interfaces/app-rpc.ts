import type { ElectronData, IpcResponse } from '../ipc-events'
import type {
  AddConversationsSchema,
  AddMcpConfigSchema,
  AllAvailableModelsSchema,
  CreateProviderConfigModelSchema,
  CreateProviderConfigSchema,
  McpConfigSchema,
  ProviderConfigModelSchema,
  ProviderConfigSchema,
  UpdateConversationsSchema,
  UpdateMcpConfigSchema,
  UpdateProviderConfigSchema,
} from '../schemas'
import type { AgentMemoryFiles, UpdateAgentMemoryInput } from './agent-memory'
import type {
  AgentTaskSnapshot,
  ApprovePendingActionOptions,
  RejectPendingActionOptions,
} from './agent-runtime'
import type { AgentTurnResult, StartAgentTurnOptions } from './agent-runtime-electron'
import type { RunBuiltinCommandParams, RunBuiltinCommandResult } from './builtin-command'
import type { handleInitConversationTitleOptions } from './conversation-title'
import type { IConversations, IMessage } from './db-types'
import type { GeneralSettingsState } from './generalSettings'
import type { SearchResult } from './global-search'
import type { McpConnection, McpTool, McpToolCallResponse } from './mcp'
import type { ModelsDevImportResult, ModelsDevModel, ModelsDevProvider } from './modelsDev'
import type { ImportSkillFromGithubOptions, SetSkillEnabledOptions, SkillIndex, SkillManifest } from './skill'
import type { UpdateConfig, UpdateInfo, UpdateStatus } from './update'
import type { ListWorkspacesData, WorkspaceDirectoryListing, WorkspaceFileSearchResult } from './workspace'

export interface AppRuntimeCapabilities {
  nativeWindow: boolean
  autoUpdate: boolean
  nativeFilePicker: boolean
}

export interface RpcEndpoint<TInput, TOutput> {
  input: TInput
  output: TOutput
}

export interface AppRpcContract {
  'chat.createConversationsTitle': RpcEndpoint<handleInitConversationTitleOptions, IConversations>
  'chat.getConversations': RpcEndpoint<{ pageIndex: number, pageSize: number }, { data: IConversations[], total: number }>
  'chat.getWorkspaceConversations': RpcEndpoint<{ workspacePath: string, pageIndex: number, pageSize: number }, { data: IConversations[], total: number }>
  'chat.getConversationById': RpcEndpoint<{ id: string }, IConversations>
  'chat.addConversation': RpcEndpoint<{ conversation: AddConversationsSchema }, IConversations>
  'chat.updateConversation': RpcEndpoint<{ conversation: UpdateConversationsSchema }, IConversations>
  'chat.deleteConversation': RpcEndpoint<{ id: string }, null>
  'chat.clearWorkspaceConversations': RpcEndpoint<{ workspacePath: string }, string[]>
  'chat.getMessagesByConvId': RpcEndpoint<{ convId: string }, IMessage[]>
  'chat.getMessageById': RpcEndpoint<{ id: string }, IMessage>
  'chat.addMessage': RpcEndpoint<{ message: IMessage }, IMessage>
  'chat.updateMessage': RpcEndpoint<{ message: IMessage }, IMessage>
  'chat.deleteMessage': RpcEndpoint<{ id: string }, null>
  'chat.batchDeleteMessages': RpcEndpoint<{ ids: string[] }, null>

  'settings.getSettings': RpcEndpoint<undefined, GeneralSettingsState>
  'settings.updateSettings': RpcEndpoint<{ updates: Partial<GeneralSettingsState> }, GeneralSettingsState>
  'settings.resetSettings': RpcEndpoint<undefined, GeneralSettingsState>
  'settings.testProxyConnection': RpcEndpoint<{ proxyUrl: string }, boolean>

  'provider.listProviders': RpcEndpoint<undefined, ProviderConfigSchema[]>
  'provider.createProvider': RpcEndpoint<{ config: CreateProviderConfigSchema }, ProviderConfigSchema>
  'provider.updateProvider': RpcEndpoint<{ config: UpdateProviderConfigSchema }, ProviderConfigSchema>
  'provider.deleteProvider': RpcEndpoint<{ id: string }, null>
  'provider.getProviderById': RpcEndpoint<{ id: string }, ProviderConfigSchema>
  'provider.getAllAbvailableModels': RpcEndpoint<undefined, AllAvailableModelsSchema[]>
  'provider.listProviderModels': RpcEndpoint<{ id: string }, ProviderConfigModelSchema[]>
  'provider.setModelEnabledStatus': RpcEndpoint<{ id: string, status: boolean }, ProviderConfigModelSchema>
  'provider.createProviderModel': RpcEndpoint<{ config: CreateProviderConfigModelSchema }, ProviderConfigModelSchema>
  'provider.deleteProviderModel': RpcEndpoint<{ id: string }, null>
  'provider.getModel': RpcEndpoint<{ providerId: string, modelId: string }, ProviderConfigModelSchema>
  'provider.getModelsDevProviders': RpcEndpoint<undefined, ModelsDevProvider[]>
  'provider.getModelsDevModelsByProviderId': RpcEndpoint<{ providerId: string }, ModelsDevModel[]>
  'provider.importModelsDevModels': RpcEndpoint<{ providerId: string }, ModelsDevImportResult>

  'skills.listSkills': RpcEndpoint<undefined, SkillIndex>
  'skills.importSkillFromGithub': RpcEndpoint<{ options: ImportSkillFromGithubOptions }, SkillManifest>
  'skills.setSkillEnabled': RpcEndpoint<{ options: SetSkillEnabledOptions }, SkillManifest>
  'skills.deleteSkill': RpcEndpoint<{ name: string }, null>
  'skills.rebuildSkillIndex': RpcEndpoint<undefined, SkillIndex>

  'memory.getMemoryFiles': RpcEndpoint<undefined, AgentMemoryFiles>
  'memory.updateMemoryFiles': RpcEndpoint<{ input: UpdateAgentMemoryInput }, AgentMemoryFiles>
  'memory.rollbackSoul': RpcEndpoint<undefined, AgentMemoryFiles>

  'mcp.getConfigs': RpcEndpoint<undefined, McpConfigSchema[]>
  'mcp.getConfigByServerName': RpcEndpoint<{ serverName: string }, McpConfigSchema>
  'mcp.addConfig': RpcEndpoint<{ config: AddMcpConfigSchema }, McpConfigSchema>
  'mcp.updateConfig': RpcEndpoint<{ config: UpdateMcpConfigSchema }, McpConfigSchema>
  'mcp.deleteConfig': RpcEndpoint<{ serverName: string }, null>
  'mcp.getConnections': RpcEndpoint<undefined, McpConnection[]>
  'mcp.getAllAvailableToolsList': RpcEndpoint<undefined, McpTool[]>
  'mcp.callTool': RpcEndpoint<{ serverName: string, toolName: string, toolArguments?: Record<string, unknown> }, McpToolCallResponse>
  'mcp.connectMcpServer': RpcEndpoint<{ name: string, config: McpConfigSchema }, null>
  'mcp.disconnectMcpServer': RpcEndpoint<{ name: string }, null>
  'mcp.reconnectMcpServer': RpcEndpoint<{ name: string, config: McpConfigSchema }, null>
  'mcp.fetchMcpServerTools': RpcEndpoint<{ name: string }, McpTool[]>

  'search.searchByKeyword': RpcEndpoint<{ query: string }, SearchResult[]>

  'workspace.listWorkspaces': RpcEndpoint<undefined, ListWorkspacesData>
  'workspace.addWorkspace': RpcEndpoint<{ path: string }, ListWorkspacesData>
  'workspace.removeWorkspace': RpcEndpoint<{ path: string }, ListWorkspacesData>
  'workspace.openWorkspace': RpcEndpoint<{ path: string }, ListWorkspacesData>
  'workspace.reorderWorkspaces': RpcEndpoint<{ paths: string[] }, ListWorkspacesData>
  'workspace.getDefaultWorkspacePath': RpcEndpoint<undefined, string>
  'workspace.listDirectories': RpcEndpoint<{ path?: string } | undefined, WorkspaceDirectoryListing>
  'workspace.createDirectory': RpcEndpoint<{ parentPath: string, name: string }, { name: string, path: string }>
  'workspace.searchWorkspaceFiles': RpcEndpoint<{ workspacePath: string, query?: string, limit?: number }, WorkspaceFileSearchResult[]>

  'agent.startTurn': RpcEndpoint<{ options: StartAgentTurnOptions }, AgentTurnResult>
  'agent.approvePendingAction': RpcEndpoint<{ options: ApprovePendingActionOptions }, null>
  'agent.rejectPendingAction': RpcEndpoint<{ options: RejectPendingActionOptions }, null>
  'agent.approvePendingActionWithWhitelist': RpcEndpoint<{ options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string } }, null>
  'agent.resolveSecretRequest': RpcEndpoint<{ options: { requestId: string, value?: string, values?: Record<string, string> } }, null>
  'agent.rejectSecretRequest': RpcEndpoint<{ options: { requestId: string, reason?: string } }, null>
  'agent.cancelTask': RpcEndpoint<{ taskId: string }, null>
  'agent.injectSteering': RpcEndpoint<{ conversationId: string, text: string }, IMessage>
  'agent.listActiveTasks': RpcEndpoint<{ conversationId?: string } | undefined, AgentTaskSnapshot[]>

  'commands.runBuiltinCommand': RpcEndpoint<RunBuiltinCommandParams, RunBuiltinCommandResult>
  'commands.cancelCommand': RpcEndpoint<{ conversationId: string }, null>
}

export type AppRpcMethod = keyof AppRpcContract & string
export type AppRpcInput<TMethod extends AppRpcMethod> = AppRpcContract[TMethod]['input']
export type AppRpcOutput<TMethod extends AppRpcMethod> = AppRpcContract[TMethod]['output']

export interface AppRpcClient {
  call: <TMethod extends AppRpcMethod>(
    method: TMethod,
    input: AppRpcInput<TMethod>,
  ) => Promise<AppRpcOutput<TMethod>>
}

export interface AppIpcServices {
  app: {
    clipboardWrite: (data: ElectronData, type?: 'selection' | 'clipboard') => Promise<boolean>
    minimizeWindow: () => Promise<void>
    maximizeOrRestoreWindow: () => Promise<void>
    quitApp: () => Promise<void>
    focusMainWindow: () => Promise<void>
  }
  runtime: {
    call: <TMethod extends AppRpcMethod>(
      method: TMethod,
      input: AppRpcInput<TMethod>,
    ) => Promise<IpcResponse<AppRpcOutput<TMethod>>>
  }
  settings: {
    openSettingsWindow: () => Promise<IpcResponse<void>>
  }
  skills: {
    importSkillFromZip: () => Promise<IpcResponse<SkillManifest | null>>
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
}
