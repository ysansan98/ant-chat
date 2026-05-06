import type { AddConversationsSchema, ConversationsId, ConversationsSettingsSchema, IConversations } from '@ant-chat/shared'
import type { AntChatFileStructure } from '@/constants'
import { produce } from 'immer'
import chatApi from '@/api/chatApi'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { clearActiveConversations } from '../messages'
import { useConversationsStore } from './conversationsStore'

const loadingConversationPages = new Set<string>()

export function getConversationByIdAction(id: string) {
  return useConversationsStore.getState().conversations.find(c => c.id === id)
}

function saveCurrentSlice() {
  useConversationsStore.getState().saveCurrentWorkspaceSlice()
}

export async function ensureWorkspaceConversationsAction(workspacePath: string) {
  const state = useConversationsStore.getState()
  const existingSlice = state.workspaceConversations[workspacePath]
  if (existingSlice?.loaded) {
    return
  }

  useConversationsStore.setState(prev => ({
    ...prev,
    workspaceConversations: {
      ...prev.workspaceConversations,
      [workspacePath]: {
        conversations: existingSlice?.conversations || [],
        pageIndex: existingSlice?.pageIndex || 0,
        conversationsTotal: existingSlice?.conversationsTotal || 0,
        loadVersion: existingSlice?.loadVersion || 0,
        loaded: false,
      },
    },
  }))

  const pageIndex = 0
  const pageSize = state.pageSize
  const loadVersion = existingSlice?.loadVersion || 0
  const loadingKey = `${workspacePath}:${loadVersion}:${pageIndex}:${pageSize}`

  if (loadingConversationPages.has(loadingKey)) {
    return
  }
  loadingConversationPages.add(loadingKey)

  try {
    const { data, total } = await chatApi.getWorkspaceConversations(workspacePath, 0, pageSize)
    useConversationsStore.setState(prev => ({
      ...prev,
      workspaceConversations: {
        ...prev.workspaceConversations,
        [workspacePath]: {
          conversations: data,
          conversationsTotal: total,
          pageIndex: data.length < total ? 1 : 0,
          loadVersion,
          loaded: true,
        },
      },
    }))
  }
  finally {
    loadingConversationPages.delete(loadingKey)
  }
}

export async function switchWorkspaceConversationsAction(workspacePath: string) {
  await ensureWorkspaceConversationsAction(workspacePath)
  useConversationsStore.getState().switchWorkspace(workspacePath)

  const nextState = useConversationsStore.getState()
  if (nextState.conversations.length === 0 && nextState.conversationsTotal > 0) {
    await nextPageConversationsAction()
  }
}

export async function addConversationsAction(conversation: AddConversationsSchema) {
  const data = await chatApi.addConversation(conversation)

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations.splice(0, 0, data)
    draft.conversationsTotal += 1
  }))
  saveCurrentSlice()

  return data
}

export function upsertConversationAction(conversation: IConversations) {
  useConversationsStore.setState(state => produce(state, (draft) => {
    const index = draft.conversations.findIndex(item => item.id === conversation.id)
    if (index > -1) {
      draft.conversations[index] = conversation
      return
    }

    draft.conversations.splice(0, 0, conversation)
    draft.conversationsTotal += 1
  }))
  saveCurrentSlice()
}

export async function renameConversationsAction(id: ConversationsId, title: string) {
  const data = await chatApi.updateConversation({ id, title })

  useConversationsStore.setState(state => produce(state, (draft) => {
    const index = draft.conversations.findIndex(c => c.id === id)
    if (index > -1) {
      draft.conversations[index] = data
    }
  }))
  saveCurrentSlice()
}

export async function deleteConversationsAction(id: ConversationsId) {
  await chatApi.deleteConversation(id)

  await clearActiveConversations()

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations = draft.conversations.filter(c => c.id !== id)
    draft.conversationsTotal = Math.max(0, draft.conversationsTotal - 1)
  }))
  saveCurrentSlice()
}

export async function importConversationsAction(_: AntChatFileStructure) {
  throw new Error('待实现')
}

export async function clearConversationsAction() {
  await clearActiveConversations()

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations = []
    draft.pageIndex = 0
    draft.conversationsTotal = 0
    draft.loadVersion += 1
  }))
  saveCurrentSlice()
}

export async function nextPageConversationsAction() {
  const { pageIndex, pageSize, loadVersion, currentWorkspacePath } = useConversationsStore.getState()
  if (!currentWorkspacePath) {
    return
  }

  const loadingKey = `${currentWorkspacePath}:${loadVersion}:${pageIndex}:${pageSize}`

  if (loadingConversationPages.has(loadingKey)) {
    return
  }

  loadingConversationPages.add(loadingKey)

  try {
    const { data: conversations, total } = await chatApi.getWorkspaceConversations(currentWorkspacePath, pageIndex, pageSize)

    useConversationsStore.setState(state => produce(state, (draft) => {
      if (
        draft.currentWorkspacePath !== currentWorkspacePath
        || draft.loadVersion !== loadVersion
        || draft.pageIndex !== pageIndex
      ) {
        return
      }

      const existingIds = new Set(draft.conversations.map(item => item.id))
      const nextConversations = conversations.filter(item => !existingIds.has(item.id))

      draft.conversations.push(...nextConversations)
      draft.conversationsTotal = total

      if (draft.conversations.length < total) {
        draft.pageIndex = pageIndex + 1
      }
    }))
    saveCurrentSlice()
  }
  finally {
    loadingConversationPages.delete(loadingKey)
  }
}

export async function initConversationsTitle(conversationsId: string) {
  const { assistantModelId } = useGeneralSettingsStore.getState()
  let modelId = assistantModelId

  if (!modelId) {
    const conversation = getConversationByIdAction(conversationsId)
    modelId = conversation?.settings?.modelId || ''
  }

  if (!modelId) {
    console.error('initConversationsTitle fail. empty modelId. id => ', conversationsId)
    return
  }

  const resp = await chatApi.initConversationsTitle(conversationsId, modelId)

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
  saveCurrentSlice()
}

export async function updateConversationsSettingsAction(id: ConversationsId, config: Partial<ConversationsSettingsSchema>) {
  const conversations = await chatApi.getConversationById(id)

  await chatApi.updateConversation({ id, settings: { ...conversations.settings, ...config } })

  useConversationsStore.setState(state => produce(state, (draft) => {
    const conversation = draft.conversations.find(c => c.id === id)
    if (conversation) {
      conversation.settings = {
        ...conversation.settings,
        ...config,
      }
    }
  }))
  saveCurrentSlice()
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
