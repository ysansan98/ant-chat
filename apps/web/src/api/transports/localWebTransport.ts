import type { AppTransport } from '@ant-chat/shared'

export function createLocalWebTransport(): AppTransport {
  return {
    capabilities: {
      workspacePicker: false,
    },
    chat: {
      createConversationsTitle: options => localRpc('chat.createConversationsTitle', { ...options }),
      getConversations: (pageIndex, pageSize) => localRpc('chat.getConversations', { pageIndex, pageSize }),
      getWorkspaceConversations: (workspacePath, pageIndex, pageSize) => localRpc('chat.getWorkspaceConversations', { workspacePath, pageIndex, pageSize }),
      getConversationById: id => localRpc('chat.getConversationById', { id }),
      addConversation: conversation => localRpc('chat.addConversation', { conversation }),
      updateConversation: conversation => localRpc('chat.updateConversation', { conversation }),
      deleteConversation: id => localRpc('chat.deleteConversation', { id }),
      getMessagesByConvId: convId => localRpc('chat.getMessagesByConvId', { convId }),
      getMessageById: id => localRpc('chat.getMessageById', { id }),
      addMessage: message => localRpc('chat.addMessage', { message }),
      updateMessage: message => localRpc('chat.updateMessage', { message }),
      deleteMessage: id => localRpc('chat.deleteMessage', { id }),
      getMessagesByConvIdWithPagination: (id, pageIndex, pageSize) => localRpc('chat.getMessagesByConvIdWithPagination', { id, pageIndex, pageSize }),
      batchDeleteMessages: ids => localRpc('chat.batchDeleteMessages', { ids }),
    },
    settings: {
      getSettings: () => localRpc('settings.getSettings'),
      updateSettings: updates => localRpc('settings.updateSettings', { updates }),
      resetSettings: () => localRpc('settings.resetSettings'),
    },
    provider: {
      listProviders: () => localRpc('provider.listProviders'),
      createProvider: config => localRpc('provider.createProvider', { config }),
      updateProvider: config => localRpc('provider.updateProvider', { config }),
      deleteProvider: id => localRpc('provider.deleteProvider', { id }),
      getProviderById: id => localRpc('provider.getProviderById', { id }),
      getProviderByModelId: id => localRpc('provider.getProviderByModelId', { id }),
      getAllAbvailableModels: () => localRpc('provider.getAllAbvailableModels'),
      listProviderModels: id => localRpc('provider.listProviderModels', { id }),
      setModelEnabledStatus: (id, status) => localRpc('provider.setModelEnabledStatus', { id, status }),
      createProviderModel: config => localRpc('provider.createProviderModel', { config }),
      deleteProviderModel: id => localRpc('provider.deleteProviderModel', { id }),
      getModelInfoById: id => localRpc('provider.getModelById', { id }),
      getModelsDevProviders: () => localRpc('provider.getModelsDevProviders'),
      getModelsDevModelsByProviderId: providerId => localRpc('provider.getModelsDevModelsByProviderId', { providerId }),
      importModelsDevModels: providerId => localRpc('provider.importModelsDevModels', { providerId }),
    },
    skills: {
      listSkills: () => localRpc('skills.listSkills'),
      importSkillFromZip: () => localRpc('skills.importSkillFromZip'),
      importSkillFromGithub: options => localRpc('skills.importSkillFromGithub', { options }),
      setSkillEnabled: options => localRpc('skills.setSkillEnabled', { options }),
      deleteSkill: name => localRpc('skills.deleteSkill', { name }),
      rebuildSkillIndex: () => localRpc('skills.rebuildSkillIndex'),
    },
    memory: {
      getMemoryFiles: () => localRpc('memory.getMemoryFiles'),
      updateMemoryFiles: input => localRpc('memory.updateMemoryFiles', { input }),
      rollbackSoul: () => localRpc('memory.rollbackSoul'),
    },
    agent: {
      startTurn: options => localRpc('agent.startTurn', { options }),
      approvePendingAction: options => localRpc('agent.approvePendingAction', { options }),
      rejectPendingAction: options => localRpc('agent.rejectPendingAction', { options }),
      cancelTask: taskId => localRpc('agent.cancelTask', { taskId }),
      injectSteering: params => localRpc('agent.injectSteering', params),
      listActiveTasks: conversationId => localRpc('agent.listActiveTasks', { conversationId }),
      approvePendingActionWithWhitelist: options => localRpc('agent.approvePendingActionWithWhitelist', { options }),
    },
    workspace: {
      listWorkspaces: () => localRpc('workspace.listWorkspaces'),
      addWorkspace: path => localRpc('workspace.addWorkspace', { path }),
      removeWorkspace: path => localRpc('workspace.removeWorkspace', { path }),
      openWorkspace: path => localRpc('workspace.openWorkspace', { path }),
      searchWorkspaceFiles: (query, limit = 50) => localRpc('workspace.searchWorkspaceFiles', { query, limit }),
    },
  }
}

export async function localRpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params: params ?? {} }),
  })
  const payload = await response.json() as { success: boolean, data?: T, msg?: string }

  if (!payload.success) {
    throw new Error(payload.msg || `Local API failed: ${method}`)
  }

  return payload.data as T
}
