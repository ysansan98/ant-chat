import type { AddConversationsSchema, ArchivedConversationWorkspaceResult, IConversations, IMessage, IpcResponse, UpdateConversationsSchema } from '@ant-chat/shared'
import { createIpcResponse } from '@ant-chat/shared'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { getAppRpcClient } from './transports/appRpc'

async function initConversationsTitle(conversationsId: string, modelId?: string, providerId?: string): Promise<IpcResponse<IConversations>> {
  const { assistantModelId, assistantProviderId } = useGeneralSettingsStore.getState()
  const finalModelId = modelId || assistantModelId
  const finalProviderId = providerId || assistantProviderId
  const conversation = await getAppRpcClient().call('chat.createConversationsTitle', { modelId: finalModelId, providerId: finalProviderId, conversationsId })
  return createIpcResponse(true, conversation)
}

async function getConversations(pageIndex: number, pageSize: number): Promise<{ data: IConversations[], total: number }> {
  return getAppRpcClient().call('chat.getConversations', { pageIndex, pageSize })
}

async function getWorkspaceConversations(workspacePath: string, pageIndex: number, pageSize: number): Promise<{ data: IConversations[], total: number }> {
  return getAppRpcClient().call('chat.getWorkspaceConversations', { workspacePath, pageIndex, pageSize })
}

async function getArchivedConversationWorkspaces(query = '', pageSize = 20): Promise<ArchivedConversationWorkspaceResult> {
  return getAppRpcClient().call('chat.getArchivedConversationWorkspaces', { query, pageSize })
}

async function getArchivedConversations(workspacePath: string | null, pageIndex: number, pageSize: number, query = ''): Promise<{ data: IConversations[], total: number }> {
  return getAppRpcClient().call('chat.getArchivedConversations', { workspacePath, pageIndex, pageSize, query })
}

async function getConversationById(id: string): Promise<IConversations> {
  return getAppRpcClient().call('chat.getConversationById', { id })
}

async function addConversation(conversation: AddConversationsSchema): Promise<IConversations> {
  return getAppRpcClient().call('chat.addConversation', { conversation })
}

async function updateConversation(conversation: UpdateConversationsSchema): Promise<IConversations> {
  return getAppRpcClient().call('chat.updateConversation', { conversation })
}

async function deleteConversation(id: string): Promise<null> {
  return getAppRpcClient().call('chat.deleteConversation', { id })
}

async function archiveConversation(id: string): Promise<IConversations> {
  return getAppRpcClient().call('chat.archiveConversation', { id })
}

async function restoreConversation(id: string): Promise<IConversations> {
  return getAppRpcClient().call('chat.restoreConversation', { id })
}

async function deleteArchivedConversation(id: string): Promise<string[]> {
  return getAppRpcClient().call('chat.deleteArchivedConversation', { id })
}

async function deleteArchivedWorkspaceConversations(workspacePath: string | null): Promise<string[]> {
  return getAppRpcClient().call('chat.deleteArchivedWorkspaceConversations', { workspacePath })
}

async function deleteAllArchivedConversations(): Promise<string[]> {
  return getAppRpcClient().call('chat.deleteAllArchivedConversations', undefined)
}

async function clearWorkspaceConversations(workspacePath: string): Promise<string[]> {
  return getAppRpcClient().call('chat.clearWorkspaceConversations', { workspacePath })
}

async function getMessagesByConvId(convId: string): Promise<IMessage[]> {
  return getAppRpcClient().call('chat.getMessagesByConvId', { convId })
}

async function getMessageById(id: string): Promise<IMessage> {
  return getAppRpcClient().call('chat.getMessageById', { id })
}

async function addMessage(message: IMessage): Promise<IMessage> {
  return getAppRpcClient().call('chat.addMessage', { message })
}

async function updateMessage(message: IMessage): Promise<IMessage> {
  return getAppRpcClient().call('chat.updateMessage', { message })
}

async function deleteMessage(id: string): Promise<null> {
  return getAppRpcClient().call('chat.deleteMessage', { id })
}

async function batchDeleteMessages(ids: string[]): Promise<null> {
  return getAppRpcClient().call('chat.batchDeleteMessages', { ids })
}

export default {
  initConversationsTitle,
  getConversations,
  getWorkspaceConversations,
  getArchivedConversationWorkspaces,
  getArchivedConversations,
  getConversationById,
  addConversation,
  updateConversation,
  deleteConversation,
  archiveConversation,
  restoreConversation,
  deleteArchivedConversation,
  deleteArchivedWorkspaceConversations,
  deleteAllArchivedConversations,
  clearWorkspaceConversations,
  getMessagesByConvId,
  getMessageById,
  addMessage,
  updateMessage,
  deleteMessage,
  batchDeleteMessages,
}
