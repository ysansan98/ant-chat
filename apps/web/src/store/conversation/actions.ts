import type { AddConversationsSchema, ConversationsId, ConversationsSettingsSchema, IConversations } from '@ant-chat/shared'
import type { AntChatFileStructure } from '@/constants'
import { produce } from 'immer'
import chatApi from '@/api/chatApi'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import {
  cancelPendingMessageDeletion,
  completePendingMessageDeletion,
  preparePendingMessageDeletion,
} from '@/store/pendingMessages'
import { useWorkspaceStore } from '@/store/workspace'
import { clearConversationSession } from '../workspaceSession/conversationSession'
import { useConversationsStore } from './conversationsStore'

const loadingConversationPages = new Set<string>()

export function getConversationByIdAction(id: string) {
  return useConversationsStore.getState().conversations.find(c => c.id === id)
}

function saveCurrentSlice() {
  useConversationsStore.getState().saveCurrentWorkspaceSlice()
}

function getCurrentWorkspacePath(): string {
  return useWorkspaceStore.getState().currentWorkspacePath ?? ''
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

export async function loadAllWorkspaceConversationsAction(workspacePath: string) {
  const state = useConversationsStore.getState()
  const slice = workspacePath === getCurrentWorkspacePath()
    ? { conversations: state.conversations, conversationsTotal: state.conversationsTotal }
    : state.workspaceConversations[workspacePath]
  if (!slice || slice.conversations.length >= slice.conversationsTotal) {
    return
  }

  const { data, total } = await chatApi.getWorkspaceConversations(workspacePath, 0, slice.conversationsTotal)
  useConversationsStore.setState(prev => produce(prev, (draft) => {
    const target = draft.workspaceConversations[workspacePath]
    if (target) {
      target.conversations = data
      target.conversationsTotal = total
      target.pageIndex = 0
      target.loaded = true
    }
    if (workspacePath === getCurrentWorkspacePath()) {
      draft.conversations = data
      draft.conversationsTotal = total
      draft.pageIndex = 0
    }
  }))
  saveCurrentSlice()
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
    syncConversationList(draft.conversations, conversation, draft.activeWorkspacePath, draft)
    for (const [workspacePath, slice] of Object.entries(draft.workspaceConversations)) {
      syncConversationList(slice.conversations, conversation, workspacePath, slice)
    }
  }))
  saveCurrentSlice()
}

export async function archiveConversationAction(id: ConversationsId) {
  const wasActive = useConversationsStore.getState().activeConversationsId === id
  const conversation = await chatApi.archiveConversation(id)
  upsertConversationAction(conversation)
  removeConversationState(id)
  if (wasActive) {
    clearConversationSession()
  }
  if (conversation.workspacePath) {
    await backfillWorkspacePreview(conversation.workspacePath)
  }
  return { conversation, wasActive }
}

export async function restoreConversationAction(id: ConversationsId) {
  const conversation = await chatApi.restoreConversation(id)
  upsertConversationAction(conversation)
  return conversation
}

export async function renameConversationsAction(id: ConversationsId, title: string) {
  const data = await chatApi.updateConversation({ id, title })

  useConversationsStore.setState(state => produce(state, (draft) => {
    replaceConversation(draft.conversations, data)
    for (const slice of Object.values(draft.workspaceConversations)) {
      replaceConversation(slice.conversations, data)
    }
  }))
  saveCurrentSlice()
}

export async function deleteConversationsAction(id: ConversationsId) {
  const deletion = await preparePendingMessageDeletion([id])
  try {
    await chatApi.deleteConversation(id)
    completePendingMessageDeletion(deletion)
  }
  catch (error) {
    cancelPendingMessageDeletion(deletion)
    throw error
  }

  if (useConversationsStore.getState().activeConversationsId === id) {
    clearConversationSession()
  }

  useConversationsStore.setState(state => produce(state, (draft) => {
    const previousLength = draft.conversations.length
    draft.conversations = draft.conversations.filter(c => c.id !== id)
    if (draft.conversations.length !== previousLength) {
      draft.conversationsTotal = Math.max(0, draft.conversationsTotal - 1)
    }
    for (const slice of Object.values(draft.workspaceConversations)) {
      const previousLength = slice.conversations.length
      slice.conversations = slice.conversations.filter(c => c.id !== id)
      if (slice.conversations.length !== previousLength) {
        slice.conversationsTotal = Math.max(0, slice.conversationsTotal - 1)
      }
    }
  }))
  removeConversationState(id)
  saveCurrentSlice()
}

export async function importConversationsAction(_: AntChatFileStructure) {
  throw new Error('待实现')
}

export async function clearConversationsAction() {
  const currentWorkspacePath = getCurrentWorkspacePath()
  if (!currentWorkspacePath) {
    throw new Error('当前工作区路径不存在，无法清空对话')
  }

  const loadedConversationIds = useConversationsStore.getState().conversations.map(conversation => conversation.id)
  const loadedDeletion = await preparePendingMessageDeletion(loadedConversationIds)
  let deletedConversationIds: string[]
  try {
    deletedConversationIds = await chatApi.clearWorkspaceConversations(currentWorkspacePath)
    const deletedIds = new Set(deletedConversationIds)
    const loadedIds = new Set(loadedConversationIds)
    const unloadedDeletedIds = deletedConversationIds.filter(id => !loadedIds.has(id))
    const unloadedDeletion = await preparePendingMessageDeletion(unloadedDeletedIds)
    completePendingMessageDeletion(loadedDeletion, loadedConversationIds.filter(id => deletedIds.has(id)))
    cancelPendingMessageDeletion(loadedDeletion, loadedConversationIds.filter(id => !deletedIds.has(id)))
    completePendingMessageDeletion(unloadedDeletion)
  }
  catch (error) {
    cancelPendingMessageDeletion(loadedDeletion)
    throw error
  }

  clearConversationSession()

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations = []
    draft.pageIndex = 0
    draft.conversationsTotal = 0
    draft.loadVersion += 1
  }))
  saveCurrentSlice()
}

export async function nextPageConversationsAction() {
  const { pageIndex, pageSize, loadVersion } = useConversationsStore.getState()
  const currentWorkspacePath = getCurrentWorkspacePath()
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
      // 分页加载是异步的:加载期间用户可能切了工作区,加载回来时若 workspaceStore
      // 当前路径已不是发起时的路径,则丢弃结果,不污染新工作区顶层 conversations。
      if (
        useWorkspaceStore.getState().currentWorkspacePath !== currentWorkspacePath
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
  const { assistantModelId, assistantProviderId } = useGeneralSettingsStore.getState()
  let modelId = assistantModelId
  let providerId = assistantProviderId

  if (!modelId) {
    const conversation = getConversationByIdAction(conversationsId)
    modelId = conversation?.settings?.modelId || ''
    providerId = conversation?.settings?.providerId || ''
  }

  if (!modelId) {
    console.error('initConversationsTitle fail. empty modelId. id => ', conversationsId)
    return
  }

  const resp = await chatApi.initConversationsTitle(conversationsId, modelId, providerId)

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

export async function updateConversationInstructionsAction(id: ConversationsId, conversationInstructions: string) {
  const conversation = await chatApi.updateConversation({ id, conversationInstructions })
  upsertConversationAction(conversation)
  return conversation
}

/**
 * 设置会话状态。一个会话不可能同时处于 streaming 和 completed。
 * 无状态条目 = idle（空闲）。
 */
export function setConversationState(id: string, state: 'running' | 'completed') {
  useConversationsStore.setState(prev => ({
    conversationStates: { ...prev.conversationStates, [id]: state },
  }))
}

export function removeConversationState(id: string) {
  useConversationsStore.setState((prev) => {
    const next = { ...prev.conversationStates }
    delete next[id]
    return { conversationStates: next }
  })
}

export function touchConversationUpdatedAt(id: string, updatedAt: number) {
  useConversationsStore.setState(state => produce(state, (draft) => {
    touchConversation(draft.conversations, id, updatedAt)
    for (const slice of Object.values(draft.workspaceConversations)) {
      touchConversation(slice.conversations, id, updatedAt)
    }
  }))
}

function replaceConversation(conversations: IConversations[], conversation: IConversations) {
  const index = conversations.findIndex(item => item.id === conversation.id)
  if (index > -1) {
    conversations[index] = conversation
  }
}

function touchConversation(conversations: IConversations[], id: string, updatedAt: number) {
  const conversation = conversations.find(item => item.id === id)
  if (conversation && conversation.updatedAt < updatedAt) {
    conversation.updatedAt = updatedAt
  }
}

function syncConversationList(
  conversations: IConversations[],
  conversation: IConversations,
  listWorkspacePath: string,
  totals: { conversationsTotal: number },
) {
  const index = conversations.findIndex(item => item.id === conversation.id)
  const belongsToList = !conversation.archived && conversation.workspacePath === listWorkspacePath

  if (!belongsToList) {
    if (index > -1) {
      conversations.splice(index, 1)
      totals.conversationsTotal = Math.max(0, totals.conversationsTotal - 1)
    }
    return
  }

  if (index > -1) {
    conversations[index] = conversation
  }
  else {
    conversations.push(conversation)
    totals.conversationsTotal += 1
  }
  conversations.sort((left, right) => right.updatedAt - left.updatedAt)
}

async function backfillWorkspacePreview(workspacePath: string) {
  const state = useConversationsStore.getState()
  const slice = workspacePath === getCurrentWorkspacePath()
    ? { conversations: state.conversations, conversationsTotal: state.conversationsTotal }
    : state.workspaceConversations[workspacePath]
  if (!slice || slice.conversations.length >= Math.min(state.pageSize, slice.conversationsTotal)) {
    return
  }

  const { data, total } = await chatApi.getWorkspaceConversations(workspacePath, 0, state.pageSize)
  useConversationsStore.setState(prev => produce(prev, (draft) => {
    const target = draft.workspaceConversations[workspacePath]
    if (target) {
      target.conversations = data
      target.conversationsTotal = total
    }
    if (workspacePath === getCurrentWorkspacePath()) {
      draft.conversations = data
      draft.conversationsTotal = total
    }
  }))
  saveCurrentSlice()
}
