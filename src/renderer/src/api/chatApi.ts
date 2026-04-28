import type { AddConversationsSchema, handleChatCompletionsOptions, IConversations, IMessage, IpcResponse, UpdateConversationsSchema } from '@ant-chat/shared'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { ipc, unwrapIpcPaginatedResponse, unwrapIpcResponse } from '@/utils/ipc-bus'

function sendChatCompletions(options: handleChatCompletionsOptions): Promise<void> {
  return ipc.chat.sendChatCompletions(options)
}

function cancelChatCompletions(conversationdsId: string): void {
  void ipc.chat.cancelChatCompletions(conversationdsId)
}

async function initConversationsTitle(conversationsId: string, modelId?: string): Promise<IpcResponse<IConversations>> {
  const { assistantModelId } = useGeneralSettingsStore.getState()
  const finalModelId = modelId || assistantModelId
  return await ipc.chat.createConversationsTitle({ modelId: finalModelId, conversationsId })
}

async function getConversations(pageIndex: number, pageSize: number): Promise<{ data: IConversations[], total: number }> {
  return unwrapIpcPaginatedResponse(await ipc.chat.getConversations(pageIndex, pageSize))
}

async function getWorkspaceConversations(workspacePath: string, pageIndex: number, pageSize: number): Promise<{ data: IConversations[], total: number }> {
  return unwrapIpcPaginatedResponse(await ipc.chat.getWorkspaceConversations(workspacePath, pageIndex, pageSize))
}

async function getConversationById(id: string): Promise<IConversations> {
  return unwrapIpcResponse(await ipc.chat.getConversationById(id))
}

async function addConversation(conversation: AddConversationsSchema): Promise<IConversations> {
  return unwrapIpcResponse(await ipc.chat.addConversation(conversation))
}

async function updateConversation(conversation: UpdateConversationsSchema): Promise<IConversations> {
  return unwrapIpcResponse(await ipc.chat.updateConversation(conversation))
}

async function deleteConversation(id: string): Promise<null> {
  return unwrapIpcResponse(await ipc.chat.deleteConversation(id))
}

async function getMessagesByConvId(convId: string): Promise<IMessage[]> {
  return unwrapIpcResponse(await ipc.chat.getMessagesByConvId(convId))
}

async function getMessageById(id: string): Promise<IMessage> {
  return unwrapIpcResponse(await ipc.chat.getMessageById(id))
}

async function addMessage(message: IMessage): Promise<IMessage> {
  return unwrapIpcResponse(await ipc.chat.addMessage(message))
}

async function updateMessage(message: IMessage): Promise<IMessage> {
  return unwrapIpcResponse(await ipc.chat.updateMessage(message))
}

async function deleteMessage(id: string): Promise<null> {
  return unwrapIpcResponse(await ipc.chat.deleteMessage(id))
}

async function getMessagesByConvIdWithPagination(id: string, pageIndex: number, pageSize: number): Promise<{ data: IMessage[], total: number }> {
  return unwrapIpcPaginatedResponse(await ipc.chat.getMessagesByConvIdWithPagination(id, pageIndex, pageSize))
}

async function batchDeleteMessages(ids: string[]): Promise<null> {
  return unwrapIpcResponse(await ipc.chat.batchDeleteMessages(ids))
}

export default {
  sendChatCompletions,
  initConversationsTitle,
  cancelChatCompletions,
  getConversations,
  getWorkspaceConversations,
  getConversationById,
  addConversation,
  updateConversation,
  deleteConversation,
  getMessagesByConvId,
  getMessageById,
  addMessage,
  updateMessage,
  deleteMessage,
  getMessagesByConvIdWithPagination,
  batchDeleteMessages,
}
