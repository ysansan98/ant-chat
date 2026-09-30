import type { AddConversationsSchema, ConversationsId, ConversationsSettingsSchema, IConversations } from '@ant-chat/shared'
import type { AntChatFileStructure } from '@/constants'
import { produce } from 'immer'
import chatApi from '@/api/chatApi'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { useMessagesStore } from '@/store/messages'
import { clearConversationPendingMessages } from '@/store/pendingMessages'
import { useWorkspaceStore } from '@/store/workspace'
import { clearConversationSession } from '../workspaceSession/conversationSession'
import {
  isWorkspaceLoaded,
  markWorkspaceLoaded,
  selectWorkspaceConversations,
  useConversationsStore,
} from './conversationsStore'
import { PAGE_SIZE } from './initialState'

const loadingKeys = new Set<string>()

export function getConversationByIdAction(id: string) {
  return useConversationsStore.getState().conversations.find(c => c.id === id)
}

function getCurrentWorkspacePath(): string {
  return useWorkspaceStore.getState().currentWorkspacePath ?? ''
}

function sortByUpdatedAtDesc(conversations: IConversations[]): void {
  conversations.sort((left, right) => right.updatedAt - left.updatedAt)
}

/**
 * 用服务端返回的 `data` 替换某工作区在平铺列表中的全部条目，并按 updatedAt 降序重排。
 * conversations 平铺后，一条会话只属于一个工作区，其他工作区条目不受影响。
 */
function replaceWorkspace(conversations: IConversations[], workspacePath: string, data: IConversations[]): void {
  const others = conversations.filter(c => c.workspacePath !== workspacePath)
  conversations.splice(0, conversations.length, ...others, ...data)
  sortByUpdatedAtDesc(conversations)
}

function bumpWorkspaceTotal(totals: Record<string, number>, workspacePath: string, delta: number): void {
  totals[workspacePath] = Math.max(0, (totals[workspacePath] ?? 0) + delta)
}

export async function ensureWorkspaceConversationsAction(workspacePath: string) {
  if (isWorkspaceLoaded(workspacePath)) {
    return
  }

  const loadingKey = `ensure:${workspacePath}`
  if (loadingKeys.has(loadingKey)) {
    return
  }
  loadingKeys.add(loadingKey)

  try {
    const { data, total } = await chatApi.getWorkspaceConversations(workspacePath, 0, PAGE_SIZE)
    useConversationsStore.setState(prev => produce(prev, (draft) => {
      replaceWorkspace(draft.conversations, workspacePath, data)
      draft.conversationsTotal[workspacePath] = total
    }))
    markWorkspaceLoaded(workspacePath)
  }
  finally {
    loadingKeys.delete(loadingKey)
  }
}

export async function loadAllWorkspaceConversationsAction(workspacePath: string) {
  const state = useConversationsStore.getState()
  const loaded = selectWorkspaceConversations(state, workspacePath)
  const total = state.conversationsTotal[workspacePath] ?? loaded.length
  if (loaded.length >= total) {
    return
  }

  const loadingKey = `load-all:${workspacePath}`
  if (loadingKeys.has(loadingKey)) {
    return
  }
  loadingKeys.add(loadingKey)

  try {
    const { data, total: nextTotal } = await chatApi.getWorkspaceConversations(
      workspacePath,
      0,
      Math.max(total, PAGE_SIZE),
    )
    useConversationsStore.setState(prev => produce(prev, (draft) => {
      replaceWorkspace(draft.conversations, workspacePath, data)
      draft.conversationsTotal[workspacePath] = nextTotal
    }))
    markWorkspaceLoaded(workspacePath)
  }
  finally {
    loadingKeys.delete(loadingKey)
  }
}

export async function initWorkspaceConversationTotals() {
  try {
    const totals = await chatApi.getWorkspaceConversationTotals()
    useConversationsStore.setState(prev => produce(prev, (draft) => {
      draft.conversationsTotal = totals
    }))
  }
  catch (error) {
    // 失败静默：运行期 total 仍可由本地修正与后台事件兜底
    console.error('初始化工作区会话总数失败', error)
  }
}

export async function addConversationsAction(conversation: AddConversationsSchema) {
  const data = await chatApi.addConversation(conversation)

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations.unshift(data)
    if (data.workspacePath) {
      bumpWorkspaceTotal(draft.conversationsTotal, data.workspacePath, 1)
    }
  }))

  return data
}

export function upsertConversationAction(conversation: IConversations) {
  useConversationsStore.setState(state => produce(state, (draft) => {
    syncConversationList(draft.conversations, conversation)
  }))
}

/** 平铺列表只保留未归档会话；已归档会话从列表移除（total 由归档/恢复动作维护）。 */
function syncConversationList(conversations: IConversations[], conversation: IConversations) {
  const index = conversations.findIndex(item => item.id === conversation.id)
  if (conversation.archived) {
    if (index > -1) {
      conversations.splice(index, 1)
    }
    return
  }
  if (index > -1) {
    conversations[index] = conversation
  }
  else {
    conversations.push(conversation)
  }
  sortByUpdatedAtDesc(conversations)
}

export async function archiveConversationAction(id: ConversationsId) {
  const wasActive = useMessagesStore.getState().activeConversationsId === id
  const conversation = await chatApi.archiveConversation(id)
  const workspacePath = conversation.workspacePath
  if (workspacePath) {
    useConversationsStore.setState(state => produce(state, (draft) => {
      bumpWorkspaceTotal(draft.conversationsTotal, workspacePath, -1)
    }))
  }
  upsertConversationAction(conversation)
  removeConversationState(id)
  if (wasActive) {
    clearConversationSession()
  }
  if (workspacePath) {
    await backfillWorkspacePreview(workspacePath)
  }
  return { conversation, wasActive }
}

export async function restoreConversationAction(id: ConversationsId) {
  const conversation = await chatApi.restoreConversation(id)
  const workspacePath = conversation.workspacePath
  if (workspacePath) {
    useConversationsStore.setState(state => produce(state, (draft) => {
      bumpWorkspaceTotal(draft.conversationsTotal, workspacePath, 1)
    }))
  }
  upsertConversationAction(conversation)
  return conversation
}

export async function renameConversationsAction(id: ConversationsId, title: string) {
  const data = await chatApi.updateConversation({ id, title })

  useConversationsStore.setState(state => produce(state, (draft) => {
    replaceConversation(draft.conversations, data)
  }))
}

export async function deleteConversationsAction(id: ConversationsId) {
  await chatApi.deleteConversation(id)
  // 会话删除后服务端队列已随外键级联清理，这里同步清掉本地投影
  clearConversationPendingMessages(id)

  if (useMessagesStore.getState().activeConversationsId === id) {
    clearConversationSession()
  }

  useConversationsStore.setState(state => produce(state, (draft) => {
    const index = draft.conversations.findIndex(c => c.id === id)
    if (index > -1) {
      const [removed] = draft.conversations.splice(index, 1)
      const workspacePath = removed.workspacePath
      if (workspacePath) {
        bumpWorkspaceTotal(draft.conversationsTotal, workspacePath, -1)
      }
    }
  }))
  removeConversationState(id)
}

export async function importConversationsAction(_: AntChatFileStructure) {
  throw new Error('待实现')
}

export async function clearConversationsAction() {
  const currentWorkspacePath = getCurrentWorkspacePath()
  if (!currentWorkspacePath) {
    throw new Error('当前工作区路径不存在，无法清空对话')
  }

  const loadedConversationIds = selectWorkspaceConversations(
    useConversationsStore.getState(),
    currentWorkspacePath,
  ).map(conversation => conversation.id)
  const deletedConversationIds = await chatApi.clearWorkspaceConversations(currentWorkspacePath)
  for (const conversationId of new Set([...loadedConversationIds, ...deletedConversationIds]))
    clearConversationPendingMessages(conversationId)

  clearConversationSession()

  useConversationsStore.setState(state => produce(state, (draft) => {
    draft.conversations = draft.conversations.filter(
      conversation => conversation.workspacePath !== currentWorkspacePath,
    )
    draft.conversationsTotal[currentWorkspacePath] = 0
  }))
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
    sortByUpdatedAtDesc(draft.conversations)
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

async function backfillWorkspacePreview(workspacePath: string) {
  const state = useConversationsStore.getState()
  const loaded = selectWorkspaceConversations(state, workspacePath)
  const total = state.conversationsTotal[workspacePath] ?? loaded.length
  if (loaded.length >= Math.min(PAGE_SIZE, total)) {
    return
  }

  const { data, total: nextTotal } = await chatApi.getWorkspaceConversations(workspacePath, 0, PAGE_SIZE)
  useConversationsStore.setState(prev => produce(prev, (draft) => {
    replaceWorkspace(draft.conversations, workspacePath, data)
    draft.conversationsTotal[workspacePath] = nextTotal
  }))
}
