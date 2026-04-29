import type { ChatFeatures, ConversationsId, ConversationsSettingsSchema, IMessage, MessageId } from '@ant-chat/shared'
import { produce } from 'immer'
import agentApi from '@/api/agentApi'
import chatApi from '@/api/chatApi'
import { useConversationsStore } from '../conversation/conversationsStore'
import { useMessagesStore } from './store'

export async function clearActiveConversations() {
  useMessagesStore.setState(state => produce(state, (draft) => {
    draft.activeConversationsId = '' as ConversationsId
    draft.messages = []
    draft.pageIndex = 0
    draft.messageTotal = 0
  }))
  useConversationsStore.getState().setActiveConversationsId('')
}

export async function setActiveConversationsId(id: ConversationsId | '') {
  if (!id) {
    await clearActiveConversations()
    return
  }

  const { pageSize } = useMessagesStore.getState()
  const { data: messages, total } = await chatApi.getMessagesByConvIdWithPagination(id, 0, pageSize)

  useMessagesStore.setState(state => produce(state, (draft) => {
    draft.activeConversationsId = id as ConversationsId
    draft.messages.splice(0, draft.messages.length, ...messages)
    draft.pageIndex = 1
    draft.messageTotal = total
  }))
  useConversationsStore.getState().setActiveConversationsId(id)
}

export async function addMessageAction(message: IMessage) {
  const data = await chatApi.addMessage(message)

  useMessagesStore.setState(state => produce(state, (draft) => {
    draft.messages.push({ ...data })
  }))

  return data
}

export async function deleteMessageAction(messageId: MessageId) {
  await chatApi.deleteMessage(messageId)

  useMessagesStore.setState(state => produce(state, (draft) => {
    const index = draft.messages.findIndex(m => m.id === messageId)
    if (index !== -1) {
      draft.messages.splice(index, 1)
    }
  }))
}

export async function updateMessageAction(_message: IMessage) {
  const message = await chatApi.updateMessage(_message)

  useMessagesStore.setState(state => produce(state, (draft) => {
    const index = draft.messages.findIndex(m => m.id === message.id)
    if (index === -1)
      throw new Error(`Message not found => ${message.id}`)

    draft.messages[index] = message
  }))

  return message
}

export async function updateMessageActionV2(message: IMessage) {
  const { convId } = message
  const { activeConversationsId } = useMessagesStore.getState()
  if (convId !== activeConversationsId) {
    return
  }

  useMessagesStore.setState(state => produce(state, (draft) => {
    const messageIndex = draft.messages.findIndex(msg => msg.id === message.id)

    if (messageIndex > -1) {
      draft.messages[messageIndex] = message
    }
    else {
      draft.messages.push(message)
    }
  }))
}

export function abortSendChatCompletions(conversationsId: string) {
  try {
    chatApi.cancelChatCompletions(conversationsId)
  }
  catch (e) {
    console.log('execute abort callback fail => ', e)
  }
}

export async function sendChatCompletions(conversationId: string | ConversationsId, features: ChatFeatures, chatSettings: ConversationsSettingsSchema) {
  chatApi.sendChatCompletions({
    conversationsId: conversationId as string,
    chatSettings: {
      ...chatSettings,
      features,
    },
  })
}

export async function onRequestAction(conversationId: ConversationsId, features: ChatFeatures, chatSettings: ConversationsSettingsSchema) {
  await sendChatCompletions(conversationId, features, chatSettings)
}

export async function refreshRequestAction(conversationId: ConversationsId, message: IMessage, features: ChatFeatures, chatSettings: ConversationsSettingsSchema) {
  await deleteMessageAction(message.id)

  await sendChatCompletions(conversationId, features, chatSettings)
}

export async function nextPageMessagesAction(conversationsId: ConversationsId) {
  const { pageIndex, pageSize } = useMessagesStore.getState()
  const { data: messages, total } = await chatApi.getMessagesByConvIdWithPagination(conversationsId, pageIndex, pageSize)

  useMessagesStore.setState(state => produce(state, (draft) => {
    draft.messages.splice(0, 0, ...messages)
    draft.pageIndex = pageIndex + 1
    draft.messageTotal = total
  }))
}

export async function abortActiveRequest(conversationId: string) {
  const taskList = await agentApi.listActiveTasks(conversationId)
  const activeTask = taskList.find(item => ['running', 'awaiting_approval'].includes(item.status))
  if (activeTask) {
    await agentApi.cancelTask(activeTask.taskId)
    return
  }
  abortSendChatCompletions(conversationId)
}
