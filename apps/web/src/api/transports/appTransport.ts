import type {
  AddConversationsSchema,
  AgentTaskSnapshot,
  AgentTurnResult,
  ApprovePendingActionOptions,
  GeneralSettingsState,
  handleInitConversationTitleOptions,
  IConversations,
  IMessage,
  IpcResponse,
  ListWorkspacesData,
  RejectPendingActionOptions,
  StartAgentTurnOptions,
  UpdateConversationsSchema,
  WorkspaceFileSearchResult,
} from '@ant-chat/shared'

export interface AppTransport {
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
  agent: {
    startTurn: (options: StartAgentTurnOptions) => Promise<AgentTurnResult>
    approvePendingAction: (options: ApprovePendingActionOptions) => Promise<null>
    rejectPendingAction: (options: RejectPendingActionOptions) => Promise<null>
    cancelTask: (taskId: string) => Promise<null>
    listActiveTasks: (conversationId?: string) => Promise<AgentTaskSnapshot[]>
    approvePendingActionWithWhitelist: (options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string }) => Promise<null>
  }
  workspace: {
    listWorkspaces: () => Promise<ListWorkspacesData>
    addWorkspace: (path: string) => Promise<ListWorkspacesData>
    removeWorkspace: (path: string) => Promise<ListWorkspacesData>
    openWorkspace: (path: string) => Promise<ListWorkspacesData>
    chooseWorkspace: () => Promise<ListWorkspacesData | null>
    searchWorkspaceFiles: (query: string, limit?: number) => Promise<WorkspaceFileSearchResult[]>
  }
}

let cachedTransport: AppTransport | null = null

export async function getAppTransport(): Promise<AppTransport> {
  if (cachedTransport) {
    return cachedTransport
  }

  if (globalThis.window?.electron?.ipcRenderer) {
    const { createElectronIpcTransport } = await import('./electronIpcTransport')
    cachedTransport = createElectronIpcTransport()
    return cachedTransport
  }

  const { createLocalWebTransport } = await import('./localWebTransport')
  cachedTransport = createLocalWebTransport()
  return cachedTransport
}
