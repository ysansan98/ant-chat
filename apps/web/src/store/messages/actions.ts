import type { ConversationsId, IMessage } from '@ant-chat/shared'
import { produce } from 'immer'
import chatApi from '@/api/chatApi'
import { syncConversationRuntime } from '../agentRuntime'
import { useConversationsStore } from '../conversation'
import { useMessagesStore } from './store'

let loadVersion = 0

export async function clearActiveConversations() {
  const version = ++loadVersion

  useMessagesStore.setState(state => produce(state, (draft) => {
    draft.activeConversationsId = '' as ConversationsId
    draft.messages = []
  }))
  useConversationsStore.getState().setActiveConversationsId('')

  return version
}

export async function setActiveConversationsId(id: ConversationsId | '') {
  if (!id) {
    await clearActiveConversations()
    return
  }

  const version = ++loadVersion

  const [messages] = await Promise.all([
    chatApi.getMessagesByConvId(id),
    syncConversationRuntime(id),
  ])

  if (version !== loadVersion) {
    return
  }

  useMessagesStore.setState(state => produce(state, (draft) => {
    const persistedMessageIds = new Set(messages.map(message => message.id))
    const pendingSteering = (draft.pendingSteeringByConversation[id] ?? [])
      .filter(message => !persistedMessageIds.has(message.id))
    if (pendingSteering.length > 0)
      draft.pendingSteeringByConversation[id] = pendingSteering
    else
      delete draft.pendingSteeringByConversation[id]
    draft.activeConversationsId = id as ConversationsId
    draft.messages.splice(0, draft.messages.length, ...messages, ...pendingSteering)
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
  useMessagesStore.setState(state => produce(state, (draft) => {
    const pendingSteering = draft.pendingSteeringByConversation[convId] ?? []
    const wasPendingSteering = pendingSteering.some(candidate => candidate.id === message.id)
    if (wasPendingSteering) {
      const remaining = pendingSteering.filter(candidate => candidate.id !== message.id)
      if (remaining.length > 0)
        draft.pendingSteeringByConversation[convId] = remaining
      else
        delete draft.pendingSteeringByConversation[convId]
    }

    if (convId !== draft.activeConversationsId)
      return

    const messageIndex = draft.messages.findIndex(msg => msg.id === message.id)

    if (wasPendingSteering) {
      if (messageIndex > -1)
        draft.messages.splice(messageIndex, 1)
      draft.messages.push(message)
    }
    else if (messageIndex > -1) {
      draft.messages[messageIndex] = message
    }
    else {
      draft.messages.push(message)
    }
  }))
}

export function addPendingSteeringMessage(message: IMessage) {
  useMessagesStore.setState(state => produce(state, (draft) => {
    const pending = draft.pendingSteeringByConversation[message.convId] ?? []
    if (
      pending.some(candidate => candidate.id === message.id)
      || draft.messages.some(candidate => candidate.id === message.id)
    ) {
      return
    }
    draft.pendingSteeringByConversation[message.convId] = [...pending, message]
    if (message.convId === draft.activeConversationsId)
      draft.messages.push(message)
  }))
}
