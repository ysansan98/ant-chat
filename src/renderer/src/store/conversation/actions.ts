import type { AddConversationsSchema, ConversationsId, ConversationsSettingsSchema } from '@ant-chat/shared'
import type { AntChatFileStructure } from '@/constants'
import { produce } from 'immer'
import chatApi from '@/api/chatApi'
import { dbApi } from '@/api/dbApi'
import { setActiveConversationsId } from '../messages'
import { useConversationsStore } from './conversationsStore'

export function getConversationByIdAction(id: string) {
  return useConversationsStore.getState().conversations.find(c => c.id === id)
}

export async function addConversationsAction(conversation: AddConversationsSchema) {
  const data = await dbApi.addConversation(conversation)

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations.splice(0, 0, data)
  }))

  return data
}

export async function renameConversationsAction(id: ConversationsId, title: string) {
  // await renameConversations(id, title)

  const data = await dbApi.updateConversation({ id, title })

  useConversationsStore.setState(state => produce(state, (draft) => {
    const index = draft.conversations.findIndex(c => c.id === id)
    if (index > -1) {
      draft.conversations[index] = data
    }
  }))
}

export async function deleteConversationsAction(id: ConversationsId) {
  await dbApi.deleteConversation(id)

  setActiveConversationsId('')

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations = draft.conversations.filter(c => c.id !== id)
  }))
}

export async function importConversationsAction(_: AntChatFileStructure) {
  throw new Error('待实现')
}

export async function clearConversationsAction() {
  // TODO 清理数据库中的所有会话数据
  await setActiveConversationsId('')

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations = []
  }))
}

export async function nextPageConversationsAction() {
  const { pageIndex, pageSize } = useConversationsStore.getState()
  const { data: conversations, total } = await dbApi.getConversations(pageIndex, pageSize)

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations.push(...conversations)

    draft.conversationsTotal = total

    if (draft.conversations.length < total) {
      draft.pageIndex = pageIndex + 1
    }
  }))
}

export async function initConversationsTitle(conversationsId: string) {
  const resp = await chatApi.initConversationsTitle(conversationsId)

  if (!resp.success) {
    console.error('initConversationsTitle fail. id => ', conversationsId)
    return
  }

  const { data } = resp
  useConversationsStore.setState(state => produce(state, (draft) => {
    const index = draft.conversations.findIndex(item => item.id === data.id)

    if (index > -1) {
      draft.conversations[index] = data
    }
  }))
}

export async function updateConversationsSettingsAction(id: ConversationsId, config: Partial<ConversationsSettingsSchema>) {
  const { systemPrompt } = config
  const conversations = await dbApi.getConversationById(id)

  if (systemPrompt && conversations.settings?.systemPrompt !== systemPrompt) {
    await dbApi.updateConversation({ id, settings: { ...conversations.settings, ...config } })
  }

  useConversationsStore.setState(state => produce(state, (draft) => {
    const conversation = draft.conversations.find(c => c.id === id)
    if (conversation) {
      conversation.settings = {
        ...conversation.settings,
        ...config,
      }
    }
  }))
}

export function addStreamingConversationId(id: string) {
  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.streamingConversationIds.add(id)
  }))
}

export function removeStreamingConversationId(id: string) {
  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.streamingConversationIds.delete(id)
  }))
}
