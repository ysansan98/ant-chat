import type { AppRpcInput, AppRpcMethod, AppRpcOutput } from '@ant-chat/shared'
import type { AppRuntime } from './appRuntime'

export type AppRpcHandlers = {
  [TMethod in AppRpcMethod]: (input: AppRpcInput<TMethod>) => AppRpcOutput<TMethod> | Promise<AppRpcOutput<TMethod>>
}

export function createAppRpcHandlers(runtime: AppRuntime): AppRpcHandlers {
  return {
    'chat.createConversationsTitle': async (input) => {
      const conversation = await runtime.chat.createConversationTitle(input.conversationsId, input.modelId, input.providerId)
      if (!conversation) {
        throw new Error(`Conversation title was not updated: ${input.conversationsId}`)
      }
      return conversation
    },
    'chat.getConversations': input => runtime.chat.listConversations(input.pageIndex, input.pageSize),
    'chat.getWorkspaceConversations': input => runtime.chat.listConversations(input.pageIndex, input.pageSize, input.workspacePath),
    'chat.getConversationById': input => runtime.chat.getConversation(input.id),
    'chat.addConversation': input => runtime.chat.createConversation(input.conversation),
    'chat.updateConversation': input => runtime.chat.updateConversation(input.conversation),
    'chat.deleteConversation': input => runtime.chat.deleteConversation(input.id),
    'chat.clearWorkspaceConversations': input => runtime.chat.clearWorkspaceConversations(input.workspacePath),
    'chat.getMessagesByConvId': input => runtime.chat.listMessages(input.convId),
    'chat.getMessageById': input => runtime.chat.getMessage(input.id),
    'chat.addMessage': input => runtime.chat.createMessage(input.message),
    'chat.updateMessage': input => runtime.chat.updateMessage(input.message),
    'chat.deleteMessage': input => runtime.chat.deleteMessage(input.id),
    'chat.batchDeleteMessages': input => runtime.chat.batchDeleteMessages(input.ids),

    'settings.getSettings': () => runtime.settings.get(),
    'settings.updateSettings': input => runtime.settings.update(input.updates),
    'settings.resetSettings': () => runtime.settings.reset(),
    'settings.testProxyConnection': input => runtime.settings.testProxy(input.proxyUrl),

    'provider.listProviders': () => runtime.provider.list(),
    'provider.createProvider': input => runtime.provider.create(input.config),
    'provider.updateProvider': input => runtime.provider.update(input.config),
    'provider.deleteProvider': input => runtime.provider.delete(input.id),
    'provider.getProviderById': input => runtime.provider.getById(input.id),
    'provider.getAllAbvailableModels': () => runtime.provider.listAvailableModels(),
    'provider.listProviderModels': input => runtime.provider.listModels(input.id),
    'provider.setModelEnabledStatus': input => runtime.provider.setModelEnabled(input.id, input.status),
    'provider.createProviderModel': input => runtime.provider.createModel(input.config),
    'provider.deleteProviderModel': input => runtime.provider.deleteModel(input.id),
    'provider.getModel': input => runtime.provider.getModel(input.providerId, input.modelId),
    'provider.getModelsDevProviders': () => runtime.provider.getModelsDevProviders(),
    'provider.getModelsDevModelsByProviderId': input => runtime.provider.getModelsDevModels(input.providerId),
    'provider.importModelsDevModels': input => runtime.provider.importModelsDevModels(input.providerId),

    'skills.listSkills': () => runtime.skills.list(),
    'skills.importSkillFromGithub': input => runtime.skills.importGithub(input.options),
    'skills.setSkillEnabled': input => runtime.skills.setEnabled(input.options),
    'skills.deleteSkill': input => runtime.skills.delete(input.name),
    'skills.rebuildSkillIndex': () => runtime.skills.rebuildIndex(),

    'memory.getMemoryFiles': () => runtime.memory.getFiles(),
    'memory.updateMemoryFiles': input => runtime.memory.updateFiles(input.input),
    'memory.rollbackSoul': () => runtime.memory.rollbackSoul(),

    'mcp.getConfigs': () => runtime.mcp.getConfigs(),
    'mcp.getConfigByServerName': input => runtime.mcp.getConfig(input.serverName),
    'mcp.addConfig': input => runtime.mcp.addConfig(input.config),
    'mcp.updateConfig': input => runtime.mcp.updateConfig(input.config),
    'mcp.deleteConfig': input => runtime.mcp.deleteConfig(input.serverName),
    'mcp.getConnections': () => runtime.mcp.getConnections(),
    'mcp.getAllAvailableToolsList': () => runtime.mcp.getAllTools(),
    'mcp.callTool': input => runtime.mcp.callTool(input.serverName, input.toolName, input.toolArguments),
    'mcp.connectMcpServer': input => runtime.mcp.connect(input.name, input.config),
    'mcp.disconnectMcpServer': input => runtime.mcp.disconnect(input.name),
    'mcp.reconnectMcpServer': input => runtime.mcp.reconnect(input.name, input.config),
    'mcp.fetchMcpServerTools': input => runtime.mcp.fetchTools(input.name),

    'search.searchByKeyword': input => runtime.search.messages(input.query),

    'workspace.listWorkspaces': () => runtime.workspace.list(),
    'workspace.addWorkspace': input => runtime.workspace.add(input.path),
    'workspace.removeWorkspace': input => runtime.workspace.remove(input.path),
    'workspace.openWorkspace': input => runtime.workspace.open(input.path),
    'workspace.getCurrentWorkspacePath': () => runtime.workspace.getCurrentPath(),
    'workspace.getDefaultWorkspacePath': () => runtime.workspace.getDefaultPath(),
    'workspace.listDirectories': input => runtime.workspace.listDirectories(input?.path),
    'workspace.createDirectory': input => runtime.workspace.createDirectory(input.parentPath, input.name),
    'workspace.searchWorkspaceFiles': input => runtime.workspace.searchFiles(input?.query, input?.limit),

    'agent.startTurn': input => runtime.agent.startTurn(input.options),
    'agent.approvePendingAction': input => runtime.agent.approvePendingAction(input.options),
    'agent.rejectPendingAction': input => runtime.agent.rejectPendingAction(input.options),
    'agent.approvePendingActionWithWhitelist': input => runtime.agent.approvePendingActionWithWhitelist(input.options),
    'agent.resolveSecretRequest': input => runtime.agent.resolveSecretRequest(input.options),
    'agent.rejectSecretRequest': input => runtime.agent.rejectSecretRequest(input.options),
    'agent.cancelTask': input => runtime.agent.cancelTask({ taskId: input.taskId }),
    'agent.injectSteering': input => runtime.agent.injectSteering(input),
    'agent.listActiveTasks': input => runtime.agent.listActiveTasks(input?.conversationId),

    'commands.runBuiltinCommand': input => runtime.commands.run(input),
    'commands.cancelCommand': input => runtime.commands.cancel(input.conversationId),
  }
}
