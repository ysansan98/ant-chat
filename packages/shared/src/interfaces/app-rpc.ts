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
  ProviderConfigSchema,
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
import type { handleInitConversationTitleOptions } from './conversation-title'
import type { IConversations, IMessage } from './db-types'
import type { GeneralSettingsState } from './generalSettings'
import type { SearchResult } from './global-search'
import type { McpConnection, McpServerLifecycleResult, McpServerTestResult, McpTool, McpToolCallResponse } from './mcp'
import type { ModelsDevImportResult, ModelsDevModel, ModelsDevProvider } from './modelsDev'
import type { ImportSkillFromGithubOptions, SetSkillEnabledOptions, SkillIndex, SkillManifest } from './skill'
import type { UpdateConfig, UpdateInfo, UpdateStatus } from './update'
import type { ListWorkspacesData, WorkspaceDirectoryListing, WorkspaceFileSearchResult } from './workspace'

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
  'channel.getSetupStatus': RpcEndpoint<{ setupId: string }, import('./channels').ChannelSetupResult>
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
  'mcp.installServer': RpcEndpoint<{ config: AddMcpConfigSchema }, McpServerLifecycleResult>
  'mcp.editServer': RpcEndpoint<{ serverName: string, updates: McpServerEditPatch }, McpServerLifecycleResult>
  'mcp.deleteServer': RpcEndpoint<{ serverName: string, deletePermissionRules: boolean }, McpServerLifecycleResult>
  'mcp.startServer': RpcEndpoint<{ serverName: string }, McpServerLifecycleResult>
  'mcp.stopServer': RpcEndpoint<{ serverName: string }, McpServerLifecycleResult>
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

  'agent.startTurn': RpcEndpoint<{ options: StartAgentTurnOptions }, AgentTurnResult>
  'agent.approvePendingAction': RpcEndpoint<{ options: ApprovePendingActionOptions }, null>
  'agent.rejectPendingAction': RpcEndpoint<{ options: RejectPendingActionOptions }, null>
  'agent.resolveSecretRequest': RpcEndpoint<{ options: { requestId: string, value?: string, values?: Record<string, string> } }, null>
  'agent.rejectSecretRequest': RpcEndpoint<{ options: { requestId: string, reason?: string } }, null>
  'agent.cancelTask': RpcEndpoint<{ taskId: string }, null>
  'agent.updateTaskMode': RpcEndpoint<{ taskId: string, mode: AgentMode }, AgentTaskSnapshot | null>
  'agent.injectSteering': RpcEndpoint<{ conversationId: string, text: string }, IMessage>
  'agent.listActiveTasks': RpcEndpoint<{ conversationId?: string } | undefined, AgentTaskSnapshot[]>

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

  'commands.runBuiltinCommand': RpcEndpoint<RunBuiltinCommandParams, RunBuiltinCommandResult>
  'commands.cancelCommand': RpcEndpoint<{ conversationId: string }, null>

  'files.getAttachmentData': RpcEndpoint<{ fileId: string }, string | null>
  'visualizations.get': RpcEndpoint<{ conversationId: string, messageId: string, fileId: string }, string | null>
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
  }
  runtime: {
    call: <TMethod extends AppRpcMethod>(
      method: TMethod,
      input: AppRpcInput<TMethod>,
    ) => Promise<IpcResponse<AppRpcOutput<TMethod>>>
  }
  skills: {
    importSkillFromZip: () => Promise<IpcResponse<SkillManifest | null>>
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
