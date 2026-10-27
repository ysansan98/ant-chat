import type { ElectronData, IpcResponse } from '../ipc-events'
import type {
  AddConversationsSchema,
  AddMcpConfigSchema,
  AllAvailableModelsSchema,
  CreateProviderConfigModelSchema,
  CreateProviderConfigSchema,
  McpConfigSchema,
  McpServerEditPatch,
  ProviderConfigModelSchema,
  ProviderIntegrationCatalogItem,
  ProviderPublicView,
  UpdateConversationsSchema,
  UpdateProviderConfigSchema,
} from '../schemas'
import type { AgentObservabilityEvidence, AgentTurnIdentity, AgentTurnSummary, AgentTurnTimeline } from '../schemas/agentObservability'
import type { ToolApprovalRule, ToolApprovalRuleInput } from '../schemas/toolApprovalRules'
import type { AgentMemoryFiles, UpdateAgentMemoryInput } from './agent-memory'
import type {
  AgentMode,
  AgentTaskSnapshot,
  ApprovePendingActionOptions,
  RejectPendingActionOptions,
} from './agent-runtime'
import type { AgentTurnResult, StartAgentTurnOptions } from './agent-runtime-electron'
import type { AgentCommandHostStatus } from './agent-runtime-interfaces'
import type { ArchivedConversationWorkspaceResult } from './archived-conversations'
import type { AutomationDefinition, AutomationInput, AutomationRun, UpdateAutomationInput } from './automation'
import type { BrowserIdentityStatus, BrowserProfileSourceView } from './browser-profiles'
import type { RunBuiltinCommandParams, RunBuiltinCommandResult } from './builtin-command'
import type { ProviderUsageStatus } from './codex'
import type { handleInitConversationTitleOptions } from './conversation-title'
import type { IConversations, IMessage } from './db-types'
import type { GeneralSettingsState } from './generalSettings'
import type { SearchResult } from './global-search'
import type { McpConnection, McpServerLifecycleResult, McpServerTestResult, McpTool, McpToolCallResponse } from './mcp'
import type { MemoryCatalogListEntry, MemoryRecord } from './memory-catalog'
import type { ModelsDevProvider } from './modelsDev'
import type { AppPendingMessageSnapshot } from './pending-messages'
import type { ProviderAuthStatus } from './providerAuth'
import type { ProviderIntegrationProbe } from './providerProbe'
import type {
  GithubSkillPreview,
  ImportGithubSkillsResult,
  ImportSkillOptions,
  SetSkillEnabledOptions,
  SkillIndex,
  SkillManifest,
} from './skill'
import type { UpdateConfig, UpdateInfo, UpdateStatus } from './update'
import type {
  ListWorkspacesData,
  WorkspaceDirectoryEntries,
  WorkspaceDirectoryListing,
  WorkspaceFileSearchResult,
  WorkspaceFileStreamInfo,
  WorkspaceTextFileContent,
} from './workspace'

export interface AppRuntimeCapabilities {
  nativeWindow: boolean
  autoUpdate: boolean
  nativeFilePicker: boolean
}

export type CommandHostStatus = AgentCommandHostStatus

export interface RpcEndpoint<TInput, TOutput> {
  input: TInput
  output: TOutput
}

export interface AppRpcContract {
  'channel.list': RpcEndpoint<undefined, import('./channels').ChannelAccountView[]>
  'channel.setup': RpcEndpoint<{ channelType: import('./channels').ChannelType, displayName: string, defaultWorkspacePath: string, appId?: string, channelAccountId?: string }, import('./channels').ChannelSetupResult>
  'channel.getSetupStatus': RpcEndpoint<{ setupId: string, verifyCode?: string }, import('./channels').ChannelSetupResult>
  'channel.disconnect': RpcEndpoint<{ id: string }, import('./channels').ChannelAccountView>
  'channel.listPairingRequests': RpcEndpoint<{ channelAccountId: string }, import('./channels').ChannelPairing[]>
  'channel.rejectPairing': RpcEndpoint<{ id: string }, import('./channels').ChannelPairing>
  'channel.create': RpcEndpoint<{ channelType: import('./channels').ChannelType, displayName: string, credential: string, defaultWorkspacePath: string }, import('./channels').ChannelAccountView>
  'channel.update': RpcEndpoint<{ id: string, displayName?: string, credential?: string, defaultWorkspacePath?: string | null }, import('./channels').ChannelAccountView>
  'channel.delete': RpcEndpoint<{ id: string }, null>
  'channel.listPairings': RpcEndpoint<{ channelAccountId: string }, import('./channels').ChannelPairing[]>
  'channel.approvePairing': RpcEndpoint<{ id: string }, import('./channels').ChannelPairing>
  'channel.revokePairing': RpcEndpoint<{ id: string }, import('./channels').ChannelPairing>
  'channel.getStatus': RpcEndpoint<{ channelType: import('./channels').ChannelType }, { status: import('./channels').ChannelAccountStatus, lastError?: string }>
  'channel.enable': RpcEndpoint<{ id: string }, { id: string, enabled: boolean, status: import('./channels').ChannelAccountStatus }>
  'channel.disable': RpcEndpoint<{ id: string }, { id: string, enabled: boolean, status: import('./channels').ChannelAccountStatus }>
  'runtime.getCommandHostStatus': RpcEndpoint<undefined, CommandHostStatus>

  'browserProfiles.getStatus': RpcEndpoint<undefined, BrowserIdentityStatus>
  'browserProfiles.listSources': RpcEndpoint<undefined, BrowserProfileSourceView[]>
  'browserProfiles.import': RpcEndpoint<{ sourceId?: string }, BrowserIdentityStatus>
  'browserProfiles.clear': RpcEndpoint<undefined, null>

  'chat.createConversationsTitle': RpcEndpoint<handleInitConversationTitleOptions, IConversations>
  'chat.getConversations': RpcEndpoint<{ pageIndex: number, pageSize: number }, { data: IConversations[], total: number }>
  'chat.getWorkspaceConversations': RpcEndpoint<{ workspacePath: string, pageIndex: number, pageSize: number }, { data: IConversations[], total: number }>
  'chat.getWorkspaceConversationTotals': RpcEndpoint<undefined, Array<{ workspacePath: string, total: number }>>
  'chat.getArchivedConversationWorkspaces': RpcEndpoint<{ query?: string, pageSize: number }, ArchivedConversationWorkspaceResult>
  'chat.getArchivedConversations': RpcEndpoint<{ workspacePath: string | null, pageIndex: number, pageSize: number, query?: string }, { data: IConversations[], total: number }>
  'chat.getConversationById': RpcEndpoint<{ id: string }, IConversations>
  'chat.addConversation': RpcEndpoint<{ conversation: AddConversationsSchema }, IConversations>
  'chat.updateConversation': RpcEndpoint<{ conversation: UpdateConversationsSchema }, IConversations>
  'chat.deleteConversation': RpcEndpoint<{ id: string }, null>
  'chat.archiveConversation': RpcEndpoint<{ id: string }, IConversations>
  'chat.restoreConversation': RpcEndpoint<{ id: string }, IConversations>
  'chat.deleteArchivedConversation': RpcEndpoint<{ id: string }, string[]>
  'chat.deleteArchivedWorkspaceConversations': RpcEndpoint<{ workspacePath: string | null }, string[]>
  'chat.deleteAllArchivedConversations': RpcEndpoint<undefined, string[]>
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

  'provider.listProviders': RpcEndpoint<undefined, ProviderPublicView[]>
  'provider.listIntegrations': RpcEndpoint<undefined, ProviderIntegrationCatalogItem[]>
  'provider.probeIntegrations': RpcEndpoint<undefined, ProviderIntegrationProbe[]>
  'provider.createProvider': RpcEndpoint<{ config: CreateProviderConfigSchema }, ProviderPublicView>
  'provider.updateProvider': RpcEndpoint<{ config: UpdateProviderConfigSchema }, ProviderPublicView>
  'provider.deleteProvider': RpcEndpoint<{ id: string }, null>
  'provider.getProviderById': RpcEndpoint<{ id: string }, ProviderPublicView>
  'provider.getAllAbvailableModels': RpcEndpoint<undefined, AllAvailableModelsSchema[]>
  'provider.listProviderModels': RpcEndpoint<{ id: string }, ProviderConfigModelSchema[]>
  'provider.setModelEnabledStatus': RpcEndpoint<{ providerId: string, modelId: string, status: boolean }, ProviderConfigModelSchema>
  'provider.setModelsEnabledStatus': RpcEndpoint<{ providerId: string, modelIds: string[], status: boolean }, ProviderConfigModelSchema[]>
  'provider.createProviderModel': RpcEndpoint<{ config: CreateProviderConfigModelSchema }, ProviderConfigModelSchema>
  'provider.deleteProviderModel': RpcEndpoint<{ providerId: string, modelId: string }, null>
  'provider.getModel': RpcEndpoint<{ providerId: string, modelId: string }, ProviderConfigModelSchema>
  'provider.getModelsDevProviders': RpcEndpoint<undefined, ModelsDevProvider[]>
  'provider.syncModels': RpcEndpoint<{ providerId: string }, ProviderConfigModelSchema[]>
  'provider.startOAuthLogin': RpcEndpoint<{ providerId: string }, { authorizationUrl: string }>
  'provider.importLocalAuth': RpcEndpoint<{ providerId: string }, ProviderAuthStatus>
  'provider.getAuthStatus': RpcEndpoint<{ providerId: string }, ProviderAuthStatus>
  'provider.getUsage': RpcEndpoint<{ providerId: string }, ProviderUsageStatus>
  'provider.logoutAuth': RpcEndpoint<{ providerId: string }, null>

  'skills.listSkills': RpcEndpoint<undefined, SkillIndex>
  'skills.listWorkspaceSkills': RpcEndpoint<{ workspacePath: string }, SkillManifest[]>
  'skills.importSkill': RpcEndpoint<{ options: ImportSkillOptions }, SkillManifest>
  'skills.previewGithubSkills': RpcEndpoint<{ options: { url: string } }, GithubSkillPreview[]>
  'skills.importGithubSkills': RpcEndpoint<{ options: { url: string, paths: string[] } }, ImportGithubSkillsResult>
  'skills.setSkillEnabled': RpcEndpoint<{ options: SetSkillEnabledOptions }, SkillManifest>
  'skills.deleteSkill': RpcEndpoint<{ name: string }, null>
  'skills.rebuildSkillIndex': RpcEndpoint<undefined, SkillIndex>

  'memory.getMemoryFiles': RpcEndpoint<undefined, AgentMemoryFiles>
  'memory.updateMemoryFiles': RpcEndpoint<{ input: UpdateAgentMemoryInput }, AgentMemoryFiles>
  'memory.rollbackSoul': RpcEndpoint<undefined, AgentMemoryFiles>

  'memoryCatalog.list': RpcEndpoint<{ status?: MemoryRecord['status'] } | undefined, MemoryCatalogListEntry[]>
  'memoryCatalog.getBody': RpcEndpoint<{ memoryId: string }, string>
  'memoryCatalog.approve': RpcEndpoint<{ memoryId: string }, MemoryRecord>
  'memoryCatalog.archive': RpcEndpoint<{ memoryId: string }, MemoryRecord>

  'mcp.getConfigs': RpcEndpoint<undefined, McpConfigSchema[]>
  'mcp.getConfigByServerName': RpcEndpoint<{ serverName: string }, McpConfigSchema>
  'mcp.installServer': RpcEndpoint<{ config: AddMcpConfigSchema }, McpServerLifecycleResult>
  'mcp.editServer': RpcEndpoint<{ serverName: string, updates: McpServerEditPatch }, McpServerLifecycleResult>
  'mcp.deleteServer': RpcEndpoint<{ serverName: string, deletePermissionRules: boolean }, McpServerLifecycleResult>
  'mcp.startServer': RpcEndpoint<{ serverName: string }, McpServerLifecycleResult>
  'mcp.stopServer': RpcEndpoint<{ serverName: string }, McpServerLifecycleResult>
  'mcp.setServerEnabled': RpcEndpoint<{ serverName: string, enabled: boolean }, McpServerLifecycleResult>
  'mcp.testServer': RpcEndpoint<{ config: AddMcpConfigSchema }, McpServerTestResult>
  'mcp.getTestResult': RpcEndpoint<{ attemptId: string }, McpServerTestResult>
  'mcp.getConnections': RpcEndpoint<undefined, McpConnection[]>
  'mcp.getAllAvailableToolsList': RpcEndpoint<undefined, McpTool[]>
  'mcp.callTool': RpcEndpoint<{ serverName: string, toolName: string, toolArguments?: Record<string, unknown> }, McpToolCallResponse>

  'search.searchByKeyword': RpcEndpoint<{ query: string }, SearchResult[]>

  'workspace.listWorkspaces': RpcEndpoint<undefined, ListWorkspacesData>
  'workspace.addWorkspace': RpcEndpoint<{ path: string }, ListWorkspacesData>
  'workspace.removeWorkspace': RpcEndpoint<{ path: string, deletePermissionGroup: boolean }, ListWorkspacesData>
  'workspace.openWorkspace': RpcEndpoint<{ path: string }, ListWorkspacesData>
  'workspace.reorderWorkspaces': RpcEndpoint<{ paths: string[] }, ListWorkspacesData>
  'workspace.getDefaultWorkspacePath': RpcEndpoint<undefined, string>
  'workspace.listDirectories': RpcEndpoint<{ path?: string } | undefined, WorkspaceDirectoryListing>
  'workspace.createDirectory': RpcEndpoint<{ parentPath: string, name: string }, { name: string, path: string }>
  'workspace.searchWorkspaceFiles': RpcEndpoint<{ workspacePath: string, query?: string, limit?: number }, WorkspaceFileSearchResult[]>
  'workspace.listDirectoryEntries': RpcEndpoint<{ workspacePath: string, relPath?: string }, WorkspaceDirectoryEntries>
  'workspace.readTextFile': RpcEndpoint<{ workspacePath: string, relPath: string }, WorkspaceTextFileContent>
  'workspace.openWithDefaultApp': RpcEndpoint<{ workspacePath: string, relPath: string }, void>
  'workspace.resolveFileForStream': RpcEndpoint<{ workspacePath: string, relPath: string }, WorkspaceFileStreamInfo>

  'agent.startTurn': RpcEndpoint<{ options: StartAgentTurnOptions }, AgentTurnResult>
  'agent.listPendingMessages': RpcEndpoint<{ conversationId: string }, AppPendingMessageSnapshot>
  'agent.editPendingMessage': RpcEndpoint<{ conversationId: string, id: string, text: string }, AppPendingMessageSnapshot>
  'agent.removePendingMessage': RpcEndpoint<{ conversationId: string, id: string }, AppPendingMessageSnapshot>
  'agent.steerPendingMessage': RpcEndpoint<{ conversationId: string, id: string }, { message: IMessage, snapshot: AppPendingMessageSnapshot }>
  'agent.approvePendingAction': RpcEndpoint<{ options: ApprovePendingActionOptions }, null>
  'agent.rejectPendingAction': RpcEndpoint<{ options: RejectPendingActionOptions }, null>
  'agent.resolveSecretRequest': RpcEndpoint<{ options: { requestId: string, value?: string, values?: Record<string, string> } }, null>
  'agent.rejectSecretRequest': RpcEndpoint<{ options: { requestId: string, reason?: string } }, null>
  'agent.cancelTask': RpcEndpoint<{ taskId: string }, null>
  'agent.updateTaskMode': RpcEndpoint<{ taskId: string, mode: AgentMode }, AgentTaskSnapshot | null>
  'agent.injectSteering': RpcEndpoint<{ conversationId: string, text: string }, IMessage>
  'agent.listActiveTasks': RpcEndpoint<{ conversationId?: string } | undefined, AgentTaskSnapshot[]>
  'agent.listBackgroundCommands': RpcEndpoint<{ conversationId: string }, import('./agent-tools').BackgroundCommandSummary[]>
  'agent.killBackgroundCommand': RpcEndpoint<{ conversationId: string, commandId: string, signal?: 'SIGTERM' | 'SIGKILL' }, import('./agent-tools').BackgroundCommandSummary | null>
  'agent.readBackgroundCommandOutput': RpcEndpoint<{ conversationId: string, commandId: string, offset?: number, maxChars?: number, tail?: number }, import('./agent-tools').BackgroundCommandReadResult>

  'agent.listTurns': RpcEndpoint<{ conversationId: string }, AgentTurnSummary[]>
  'agent.getTurnTimeline': RpcEndpoint<AgentTurnIdentity, AgentTurnTimeline | null>
  'agent.getEvidence': RpcEndpoint<AgentTurnIdentity & { recordId: string }, AgentObservabilityEvidence | null>
  'agent.clearAllObservability': RpcEndpoint<undefined, null>

  'permissions.list': RpcEndpoint<undefined, { global: ToolApprovalRule[], workspaces: Record<string, ToolApprovalRule[]> }>
  'permissions.add': RpcEndpoint<{ scope: 'workspace' | 'global', workspacePath?: string, rule: ToolApprovalRuleInput }, ToolApprovalRule>
  'permissions.update': RpcEndpoint<{ ruleId: string, scope: 'workspace' | 'global', workspacePath?: string, rule: ToolApprovalRuleInput }, ToolApprovalRule>
  'permissions.delete': RpcEndpoint<{ ruleId: string, scope: 'workspace' | 'global', workspacePath?: string }, null>
  'permissions.clear': RpcEndpoint<{ scope: 'workspace' | 'global', workspacePath?: string }, null>
  'permissions.clearWorkspace': RpcEndpoint<{ workspacePath: string }, null>

  'automation.list': RpcEndpoint<undefined, AutomationDefinition[]>
  'automation.create': RpcEndpoint<{ input: AutomationInput }, AutomationDefinition>
  'automation.update': RpcEndpoint<{ input: UpdateAutomationInput }, AutomationDefinition>
  'automation.delete': RpcEndpoint<{ id: string }, null>
  'automation.setEnabled': RpcEndpoint<{ id: string, enabled: boolean }, AutomationDefinition>
  'automation.runNow': RpcEndpoint<{ id: string }, AutomationRun>
  'automation.listRuns': RpcEndpoint<{ automationId?: string, limit?: number }, AutomationRun[]>
  'automation.markRunRead': RpcEndpoint<{ id: string }, AutomationRun>

  'commands.runBuiltinCommand': RpcEndpoint<RunBuiltinCommandParams, RunBuiltinCommandResult>
  'commands.cancelCommand': RpcEndpoint<{ conversationId: string }, null>

  'files.getAttachmentData': RpcEndpoint<{ fileId: string }, string | null>
  'visualizations.get': RpcEndpoint<{ conversationId: string, messageId: string, fileId: string }, string | null>
}

export type AppRpcMethod = keyof AppRpcContract & string
export type AppRpcInput<TMethod extends AppRpcMethod> = AppRpcContract[TMethod]['input']
export type AppRpcOutput<TMethod extends AppRpcMethod> = AppRpcContract[TMethod]['output']

/**
 * Runtime RPC 方法白名单。
 *
 * 使用对象而非数组，`satisfies Record<AppRpcMethod, true>` 会在新增/删除
 * `AppRpcContract` 方法时给出编译错误，避免白名单与合同漂移。
 */
export const APP_RPC_METHODS = {
  'channel.list': true,
  'channel.setup': true,
  'channel.getSetupStatus': true,
  'channel.disconnect': true,
  'channel.listPairingRequests': true,
  'channel.rejectPairing': true,
  'channel.create': true,
  'channel.update': true,
  'channel.delete': true,
  'channel.listPairings': true,
  'channel.approvePairing': true,
  'channel.revokePairing': true,
  'channel.getStatus': true,
  'channel.enable': true,
  'channel.disable': true,
  'runtime.getCommandHostStatus': true,
  'browserProfiles.getStatus': true,
  'browserProfiles.listSources': true,
  'browserProfiles.import': true,
  'browserProfiles.clear': true,
  'chat.createConversationsTitle': true,
  'chat.getConversations': true,
  'chat.getWorkspaceConversations': true,
  'chat.getWorkspaceConversationTotals': true,
  'chat.getArchivedConversationWorkspaces': true,
  'chat.getArchivedConversations': true,
  'chat.getConversationById': true,
  'chat.addConversation': true,
  'chat.updateConversation': true,
  'chat.deleteConversation': true,
  'chat.archiveConversation': true,
  'chat.restoreConversation': true,
  'chat.deleteArchivedConversation': true,
  'chat.deleteArchivedWorkspaceConversations': true,
  'chat.deleteAllArchivedConversations': true,
  'chat.clearWorkspaceConversations': true,
  'chat.getMessagesByConvId': true,
  'chat.getMessageById': true,
  'chat.addMessage': true,
  'chat.updateMessage': true,
  'chat.deleteMessage': true,
  'chat.batchDeleteMessages': true,
  'settings.getSettings': true,
  'settings.updateSettings': true,
  'settings.resetSettings': true,
  'settings.testProxyConnection': true,
  'provider.listProviders': true,
  'provider.listIntegrations': true,
  'provider.probeIntegrations': true,
  'provider.createProvider': true,
  'provider.updateProvider': true,
  'provider.deleteProvider': true,
  'provider.getProviderById': true,
  'provider.getAllAbvailableModels': true,
  'provider.listProviderModels': true,
  'provider.setModelEnabledStatus': true,
  'provider.setModelsEnabledStatus': true,
  'provider.createProviderModel': true,
  'provider.deleteProviderModel': true,
  'provider.getModel': true,
  'provider.getModelsDevProviders': true,
  'provider.syncModels': true,
  'provider.startOAuthLogin': true,
  'provider.importLocalAuth': true,
  'provider.getAuthStatus': true,
  'provider.getUsage': true,
  'provider.logoutAuth': true,
  'skills.listSkills': true,
  'skills.listWorkspaceSkills': true,
  'skills.importSkill': true,
  'skills.previewGithubSkills': true,
  'skills.importGithubSkills': true,
  'skills.setSkillEnabled': true,
  'skills.deleteSkill': true,
  'skills.rebuildSkillIndex': true,
  'memory.getMemoryFiles': true,
  'memory.updateMemoryFiles': true,
  'memory.rollbackSoul': true,
  'memoryCatalog.list': true,
  'memoryCatalog.getBody': true,
  'memoryCatalog.approve': true,
  'memoryCatalog.archive': true,
  'mcp.getConfigs': true,
  'mcp.getConfigByServerName': true,
  'mcp.installServer': true,
  'mcp.editServer': true,
  'mcp.deleteServer': true,
  'mcp.startServer': true,
  'mcp.stopServer': true,
  'mcp.setServerEnabled': true,
  'mcp.testServer': true,
  'mcp.getTestResult': true,
  'mcp.getConnections': true,
  'mcp.getAllAvailableToolsList': true,
  'mcp.callTool': true,
  'search.searchByKeyword': true,
  'workspace.listWorkspaces': true,
  'workspace.addWorkspace': true,
  'workspace.removeWorkspace': true,
  'workspace.openWorkspace': true,
  'workspace.reorderWorkspaces': true,
  'workspace.getDefaultWorkspacePath': true,
  'workspace.listDirectories': true,
  'workspace.createDirectory': true,
  'workspace.searchWorkspaceFiles': true,
  'workspace.listDirectoryEntries': true,
  'workspace.readTextFile': true,
  'workspace.openWithDefaultApp': true,
  'workspace.resolveFileForStream': true,
  'agent.startTurn': true,
  'agent.listPendingMessages': true,
  'agent.editPendingMessage': true,
  'agent.removePendingMessage': true,
  'agent.steerPendingMessage': true,
  'agent.approvePendingAction': true,
  'agent.rejectPendingAction': true,
  'agent.resolveSecretRequest': true,
  'agent.rejectSecretRequest': true,
  'agent.cancelTask': true,
  'agent.updateTaskMode': true,
  'agent.injectSteering': true,
  'agent.listActiveTasks': true,
  'agent.listBackgroundCommands': true,
  'agent.killBackgroundCommand': true,
  'agent.readBackgroundCommandOutput': true,
  'agent.listTurns': true,
  'agent.getTurnTimeline': true,
  'agent.getEvidence': true,
  'agent.clearAllObservability': true,
  'permissions.list': true,
  'permissions.add': true,
  'permissions.update': true,
  'permissions.delete': true,
  'permissions.clear': true,
  'permissions.clearWorkspace': true,
  'automation.list': true,
  'automation.create': true,
  'automation.update': true,
  'automation.delete': true,
  'automation.setEnabled': true,
  'automation.runNow': true,
  'automation.listRuns': true,
  'automation.markRunRead': true,
  'commands.runBuiltinCommand': true,
  'commands.cancelCommand': true,
  'files.getAttachmentData': true,
  'visualizations.get': true,
} as const satisfies Record<AppRpcMethod, true>

export const APP_RPC_METHOD_NAMES = Object.keys(APP_RPC_METHODS) as AppRpcMethod[]

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
    focusWindow: () => Promise<void>
    quitApp: () => Promise<void>
  }
  runtime: {
    call: <TMethod extends AppRpcMethod>(
      method: TMethod,
      input: AppRpcInput<TMethod>,
    ) => Promise<IpcResponse<AppRpcOutput<TMethod>>>
  }
  browserProfiles: {
    importFromDirectory: () => Promise<IpcResponse<BrowserIdentityStatus | null>>
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

/**
 * preload 允许 invocation 的 IPC 方法白名单。
 *
 * 对象形式配合 `satisfies` 可确保每个 group 的方法与 `AppIpcServices`
 * 完全一致：新增方法未登记或登记了不存在的方法都会编译失败。
 */
export const APP_IPC_GROUP_METHODS = {
  app: {
    clipboardWrite: true,
    minimizeWindow: true,
    maximizeOrRestoreWindow: true,
    focusWindow: true,
    quitApp: true,
  },
  runtime: {
    call: true,
  },
  browserProfiles: {
    importFromDirectory: true,
  },
  update: {
    getCurrentVersion: true,
    checkForUpdatesManual: true,
    getUpdateConfig: true,
    setUpdateConfig: true,
    downloadUpdate: true,
    getUpdateStatus: true,
    checkForUpdates: true,
    quitAndInstall: true,
    cancelDownload: true,
  },
} as const satisfies {
  [K in keyof AppIpcServices]: Record<keyof AppIpcServices[K] & string, true>
}

export type AppIpcChannel = `${keyof AppIpcServices}.${string}`

export const APP_IPC_CHANNEL_NAMES: AppIpcChannel[] = Object.entries(APP_IPC_GROUP_METHODS)
  .flatMap(([group, methods]) => Object.keys(methods).map(method => `${group}.${method}` as AppIpcChannel))
