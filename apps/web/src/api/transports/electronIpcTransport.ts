import type { AppIpcServices, AppTransport } from '@ant-chat/shared'
import { createIpcProxy } from 'electron-ipc-decorator/client'
import { unwrapIpcPaginatedResponse, unwrapIpcResponse } from '@/utils/ipc-bus'

export function createElectronIpcTransport(): AppTransport {
  const ipc = createIpcProxy<AppIpcServices>(window.electron.ipcRenderer)!

  return {
    capabilities: {
      workspacePicker: true,
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
      getMessagesByConvIdWithPagination: async (id, pageIndex, pageSize) => unwrapIpcPaginatedResponse(await ipc.chat.getMessagesByConvIdWithPagination(id, pageIndex, pageSize)),
      batchDeleteMessages: async ids => unwrapIpcResponse(await ipc.chat.batchDeleteMessages(ids)),
    },
    settings: {
      getSettings: async () => unwrapIpcResponse(await ipc.settings.getSettings()),
      updateSettings: async updates => unwrapIpcResponse(await ipc.settings.updateSettings(updates)),
      resetSettings: async () => unwrapIpcResponse(await ipc.settings.resetSettings()),
    },
    provider: {
      getAllProviderServices: async () => unwrapIpcResponse(await ipc.provider.getAllProviderServices()),
      addProviderService: async config => unwrapIpcResponse(await ipc.provider.addProviderServices(config)),
      updateProviderService: async config => unwrapIpcResponse(await ipc.provider.updateProviderService(config)),
      deleteProviderService: async id => unwrapIpcResponse(await ipc.provider.deleteProviderService(id)),
      getProviderServiceById: async id => unwrapIpcResponse(await ipc.provider.getProviderServicesById(id)),
      getProviderServiceByModelId: async id => unwrapIpcResponse(await ipc.provider.getProviderServiceByModelId(id)),
      getAllAbvailableModels: async () => unwrapIpcResponse(await ipc.provider.getAllAbvailableModels()),
      getModelsByServiceProviderId: async id => unwrapIpcResponse(await ipc.provider.getModelsByServiceProviderId(id)),
      setModelEnabledStatus: async (id, status) => unwrapIpcResponse(await ipc.provider.setModelEnabledStatus(id, status)),
      addServiceProviderModel: async config => unwrapIpcResponse(await ipc.provider.addProviderServiceModel(config)),
      deleteServiceProviderModel: async id => unwrapIpcResponse(await ipc.provider.deleteProviderServiceModel(id)),
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
    profile: {
      getProfile: async () => unwrapIpcResponse(await ipc.profile.getProfile()),
      updateProfile: async input => unwrapIpcResponse(await ipc.profile.updateProfile(input)),
      rollbackSoul: async () => unwrapIpcResponse(await ipc.profile.rollbackSoul()),
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
      chooseWorkspace: async () => unwrapIpcResponse(await ipc.workspace.chooseWorkspace()),
      searchWorkspaceFiles: async (query, limit = 50) => unwrapIpcResponse(await ipc.workspace.searchWorkspaceFiles(query, limit)),
    },
  }
}
