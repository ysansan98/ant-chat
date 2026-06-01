import type { AddConversationsSchema, IConversations, IMessage, IpcResponse, UpdateConversationsSchema } from '@ant-chat/shared'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { getAppTransport } from './transports/appTransport'

async function initConversationsTitle(conversationsId: string, modelId?: string): Promise<IpcResponse<IConversations>> {
  const { assistantModelId } = useGeneralSettingsStore.getState()
  const finalModelId = modelId || assistantModelId
  return (await getAppTransport()).chat.createConversationsTitle({ modelId: finalModelId, conversationsId })
}

async function getConversations(pageIndex: number, pageSize: number): Promise<{ data: IConversations[], total: number }> {
  return (await getAppTransport()).chat.getConversations(pageIndex, pageSize)
}

async function getWorkspaceConversations(workspacePath: string, pageIndex: number, pageSize: number): Promise<{ data: IConversations[], total: number }> {
  return (await getAppTransport()).chat.getWorkspaceConversations(workspacePath, pageIndex, pageSize)
}

async function getConversationById(id: string): Promise<IConversations> {
  return (await getAppTransport()).chat.getConversationById(id)
}

async function addConversation(conversation: AddConversationsSchema): Promise<IConversations> {
  return (await getAppTransport()).chat.addConversation(conversation)
}

async function updateConversation(conversation: UpdateConversationsSchema): Promise<IConversations> {
  return (await getAppTransport()).chat.updateConversation(conversation)
}

async function deleteConversation(id: string): Promise<null> {
  return (await getAppTransport()).chat.deleteConversation(id)
}

async function getMessagesByConvId(convId: string): Promise<IMessage[]> {
  return (await getAppTransport()).chat.getMessagesByConvId(convId)
}

async function getMessageById(id: string): Promise<IMessage> {
  return (await getAppTransport()).chat.getMessageById(id)
}

async function addMessage(message: IMessage): Promise<IMessage> {
  return (await getAppTransport()).chat.addMessage(message)
}

async function updateMessage(message: IMessage): Promise<IMessage> {
  return (await getAppTransport()).chat.updateMessage(message)
}

async function deleteMessage(id: string): Promise<null> {
  return (await getAppTransport()).chat.deleteMessage(id)
}

async function batchDeleteMessages(ids: string[]): Promise<null> {
  return (await getAppTransport()).chat.batchDeleteMessages(ids)
}

export default {
  initConversationsTitle,
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
  batchDeleteMessages,
}
