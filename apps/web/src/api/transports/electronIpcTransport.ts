import type { AppIpcServices, AppTransport } from '@ant-chat/shared'
import { createIpcProxy } from 'electron-ipc-decorator/client'
import { unwrapIpcPaginatedResponse, unwrapIpcResponse } from '@/utils/ipc-bus'

export function createElectronIpcTransport(): AppTransport {
  const ipc = createIpcProxy<AppIpcServices>(window.electron.ipcRenderer)!

  return {
    capabilities: {
      nativeWindow: true,
      autoUpdate: true,
      nativeFilePicker: true,
    },
    chat: {
      createConversationsTitle: options => ipc.chat.createConversationsTitle(options),
      getConversations: async (pageIndex, pageSize) => unwrapIpcPaginatedResponse(await ipc.chat.getConversations(pageIndex, pageSize)),
      getWorkspaceConversations: async (workspacePath, pageIndex, pageSize) => unwrapIpcPaginatedResponse(await ipc.chat.getWorkspaceConversations(workspacePath, pageIndex, pageSize)),
      getConversationById: async id => unwrapIpcResponse(await ipc.chat.getConversationById(id)),
      addConversation: async conversation => unwrapIpcResponse(await ipc.chat.addConversation(conversation)),
      updateConversation: async conversation => unwrapIpcResponse(await ipc.chat.updateConversation(conversation)),
      deleteConversation: async id => unwrapIpcResponse(await ipc.chat.deleteConversation(id)),
      getMessagesByConvId: async convId => unwrapIpcResponse(await ipc.chat.getMessagesByConvId(convId)),
      getMessageById: async id => unwrapIpcResponse(await ipc.chat.getMessageById(id)),
      addMessage: async message => unwrapIpcResponse(await ipc.chat.addMessage(message)),
      updateMessage: async message => unwrapIpcResponse(await ipc.chat.updateMessage(message)),
      deleteMessage: async id => unwrapIpcResponse(await ipc.chat.deleteMessage(id)),
      batchDeleteMessages: async ids => unwrapIpcResponse(await ipc.chat.batchDeleteMessages(ids)),
    },
    settings: {
      getSettings: async () => unwrapIpcResponse(await ipc.settings.getSettings()),
      updateSettings: async updates => unwrapIpcResponse(await ipc.settings.updateSettings(updates)),
      resetSettings: async () => unwrapIpcResponse(await ipc.settings.resetSettings()),
      testProxyConnection: async proxyUrl => unwrapIpcResponse(await ipc.settings.testProxyConnection(proxyUrl)),
    },
    provider: {
      listProviders: async () => unwrapIpcResponse(await ipc.provider.listProviders()),
      createProvider: async config => unwrapIpcResponse(await ipc.provider.createProvider(config)),
      updateProvider: async config => unwrapIpcResponse(await ipc.provider.updateProvider(config)),
      deleteProvider: async id => unwrapIpcResponse(await ipc.provider.deleteProvider(id)),
      getProviderById: async id => unwrapIpcResponse(await ipc.provider.getProviderById(id)),
      getProviderByModelId: async id => unwrapIpcResponse(await ipc.provider.getProviderByModelId(id)),
      getAllAbvailableModels: async () => unwrapIpcResponse(await ipc.provider.getAllAbvailableModels()),
      listProviderModels: async id => unwrapIpcResponse(await ipc.provider.listProviderModels(id)),
      setModelEnabledStatus: async (id, status) => unwrapIpcResponse(await ipc.provider.setModelEnabledStatus(id, status)),
      createProviderModel: async config => unwrapIpcResponse(await ipc.provider.createProviderModel(config)),
      deleteProviderModel: async id => unwrapIpcResponse(await ipc.provider.deleteProviderModel(id)),
      getModelInfoById: async id => unwrapIpcResponse(await ipc.provider.getModelById(id)),
      getModelsDevProviders: async () => unwrapIpcResponse(await ipc.provider.getModelsDevProviders()),
      getModelsDevModelsByProviderId: async providerId => unwrapIpcResponse(await ipc.provider.getModelsDevModelsByProviderId(providerId)),
      importModelsDevModels: async providerId => unwrapIpcResponse(await ipc.provider.importModelsDevModels(providerId)),
    },
    skills: {
      listSkills: async () => unwrapIpcResponse(await ipc.skills.listSkills()),
      importSkillFromZip: async () => unwrapIpcResponse(await ipc.skills.importSkillFromZip()),
      importSkillFromGithub: async options => unwrapIpcResponse(await ipc.skills.importSkillFromGithub(options)),
      setSkillEnabled: async options => unwrapIpcResponse(await ipc.skills.setSkillEnabled(options)),
      deleteSkill: async name => unwrapIpcResponse(await ipc.skills.deleteSkill(name)),
      rebuildSkillIndex: async () => unwrapIpcResponse(await ipc.skills.rebuildSkillIndex()),
    },
    memory: {
      getMemoryFiles: async () => unwrapIpcResponse(await ipc.memory.getMemoryFiles()),
      updateMemoryFiles: async input => unwrapIpcResponse(await ipc.memory.updateMemoryFiles(input)),
      rollbackSoul: async () => unwrapIpcResponse(await ipc.memory.rollbackSoul()),
    },
    mcp: {
      getConfigs: async () => unwrapIpcResponse(await ipc.mcp.getConfigs()),
      getConfigByServerName: async serverName => unwrapIpcResponse(await ipc.mcp.getConfigByServerName(serverName)),
      addConfig: async config => unwrapIpcResponse(await ipc.mcp.addConfig(config)),
      updateConfig: async config => unwrapIpcResponse(await ipc.mcp.updateConfig(config)),
      deleteConfig: async serverName => unwrapIpcResponse(await ipc.mcp.deleteConfig(serverName)),
      getConnections: async () => unwrapIpcResponse(await ipc.mcp.getConnections()),
      getAllAvailableToolsList: async () => unwrapIpcResponse(await ipc.mcp.getAllAvailableToolsList()),
      callTool: async (serverName, toolName, toolArguments) => unwrapIpcResponse(await ipc.mcp.callTool(serverName, toolName, toolArguments)),
      connectMcpServer: async (name, config) => unwrapIpcResponse(await ipc.mcp.connectMcpServer(name, config)),
      disconnectMcpServer: async name => unwrapIpcResponse(await ipc.mcp.disconnectMcpServer(name)),
      reconnectMcpServer: async (name, config) => unwrapIpcResponse(await ipc.mcp.reconnectMcpServer(name, config)),
      fetchMcpServerTools: async name => unwrapIpcResponse(await ipc.mcp.fetchMcpServerTools(name)),
    },
    search: {
      searchByKeyword: async query => unwrapIpcResponse(await ipc.search.searchByKeyword(query)),
    },
    agent: {
      startTurn: async options => unwrapIpcResponse(await ipc.agent.startTurn(options)),
      approvePendingAction: async options => unwrapIpcResponse(await ipc.agent.approvePendingAction(options)),
      rejectPendingAction: async options => unwrapIpcResponse(await ipc.agent.rejectPendingAction(options)),
      cancelTask: async taskId => unwrapIpcResponse(await ipc.agent.cancelTask({ taskId })),
      injectSteering: async params => unwrapIpcResponse(await ipc.agent.injectSteering(params)),
      listActiveTasks: async conversationId => unwrapIpcResponse(await ipc.agent.listActiveTasks(conversationId)),
      approvePendingActionWithWhitelist: async options => unwrapIpcResponse(await ipc.agent.approvePendingActionWithWhitelist(options)),
    },
    workspace: {
      listWorkspaces: async () => unwrapIpcResponse(await ipc.workspace.listWorkspaces()),
      addWorkspace: async path => unwrapIpcResponse(await ipc.workspace.addWorkspace(path)),
      removeWorkspace: async path => unwrapIpcResponse(await ipc.workspace.removeWorkspace(path)),
      openWorkspace: async path => unwrapIpcResponse(await ipc.workspace.openWorkspace(path)),
      listDirectories: async path => unwrapIpcResponse(await ipc.workspace.listDirectories(path)),
      createDirectory: async (parentPath, name) => unwrapIpcResponse(await ipc.workspace.createDirectory(parentPath, name)),
      searchWorkspaceFiles: async (query, limit = 50) => unwrapIpcResponse(await ipc.workspace.searchWorkspaceFiles(query, limit)),
    },
    commands: {
      runBuiltinCommand: async params => unwrapIpcResponse(await ipc.commands.runBuiltinCommand(params)),
      cancelCommand: async conversationId => unwrapIpcResponse(await ipc.commands.cancelCommand(conversationId)),
    },
  }
}
