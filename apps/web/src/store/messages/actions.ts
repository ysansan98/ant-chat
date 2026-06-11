import type { ConversationsId, IMessage } from '@ant-chat/shared'
import { produce } from 'immer'
import agentApi from '@/api/agentApi'
import chatApi from '@/api/chatApi'
import { syncConversationAgentState } from '../agent'
import { useConversationsStore } from '../conversation/conversationsStore'
import { useMessagesStore } from './store'

export async function clearActiveConversations() {
  useMessagesStore.setState(state => produce(state, (draft) => {
    draft.activeConversationsId = '' as ConversationsId
    draft.messages = []
  }))
  useConversationsStore.getState().setActiveConversationsId('')
}

export async function setActiveConversationsId(id: ConversationsId | '') {
  if (!id) {
    await clearActiveConversations()
    return
  }

  const [messages] = await Promise.all([
    chatApi.getMessagesByConvId(id),
    syncConversationAgentState(id),
  ])

  useMessagesStore.setState(state => produce(state, (draft) => {
    draft.activeConversationsId = id as ConversationsId
    draft.messages.splice(0, draft.messages.length, ...messages)
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

export async function abortActiveRequest(conversationId: string) {
  const taskList = await agentApi.listActiveTasks(conversationId)
  const activeTask = taskList.find(item => ['running', 'awaiting_approval'].includes(item.status))
  if (activeTask) {
    await agentApi.cancelTask(activeTask.taskId)
  }
}
