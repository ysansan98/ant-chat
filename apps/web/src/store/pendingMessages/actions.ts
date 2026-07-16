import { toast } from 'sonner'
import { useChatSttingsStore } from '@/store/chatSettings'
import { getConversationByIdAction } from '@/store/conversation'
import { submitTurnIntake } from '@/store/turnIntake'
import { useWorkspaceStore } from '@/store/workspace'
import {
  clearAllPendingMessages,
  clearConversationPendingMessages,
  editPendingMessage,
  enqueuePendingMessage,
  enqueueVisualizationNextTurn,
  removePendingMessage,
} from './queue'
import { sortPendingMessages, usePendingMessagesStore } from './store'

const drainPromises = new Map<string, Promise<void>>()
const operationPromises = new Map<string, Promise<void>>()
const deletionBarriers = new Map<string, Set<symbol>>()

/**
 * 可视化表单只能创建 next turn。运行中的会话进入队列，空闲会话直接启动新轮次。
 * 该入口集中处理 settings/workspace，避免 iframe 或消息组件自行调用 agent RPC。
 */
export async function submitVisualizationFollowUp(conversationId: string, text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed)
    throw new Error('提交内容不能为空')
  if (isConversationDeleting(conversationId))
    throw new Error('当前会话正在删除')

  await runConversationOperation(conversationId, async () => {
    const settings = getConversationByIdAction(conversationId)?.settings
    if (!settings)
      throw new Error('当前会话已不存在')
    await submitTurnIntake({
      origin: 'visualization',
      conversationId,
      messageContent: [{ type: 'text', text: trimmed }],
      workspacePath: useWorkspaceStore.getState().currentWorkspacePath,
      settings,
      mode: useChatSttingsStore.getState().agentMode,
    })
  })
}

export interface PendingMessageDeletionToken {
  readonly conversationIds: readonly string[]
  readonly owner: symbol
}

export async function preparePendingMessageDeletion(conversationIds: string[]): Promise<PendingMessageDeletionToken> {
  const token = { conversationIds: [...new Set(conversationIds)], owner: Symbol('pending-message-deletion') }
  token.conversationIds.forEach((conversationId) => {
    const owners = deletionBarriers.get(conversationId) ?? new Set<symbol>()
    owners.add(token.owner)
    deletionBarriers.set(conversationId, owners)
  })
  await Promise.allSettled(token.conversationIds.map(conversationId => operationPromises.get(conversationId)))
  return token
}

export function completePendingMessageDeletion(token: PendingMessageDeletionToken, conversationIds: string[] = [...token.conversationIds]) {
  conversationIds.forEach((conversationId) => {
    if (releaseDeletionOwner(token, conversationId))
      clearConversationPendingMessages(conversationId)
  })
}

export function cancelPendingMessageDeletion(token: PendingMessageDeletionToken, conversationIds: string[] = [...token.conversationIds]) {
  conversationIds.forEach(conversationId => releaseDeletionOwner(token, conversationId))
}

export function getPendingMessageOperationStateForTests() {
  return {
    drainCount: drainPromises.size,
    operationCount: operationPromises.size,
    tombstoneCount: deletionBarriers.size,
  }
}

export async function injectPendingMessage(conversationId: string, id: string) {
  if (isConversationDeleting(conversationId))
    return
  await runConversationOperation(conversationId, () => injectPendingMessageOnce(conversationId, id))
}

async function injectPendingMessageOnce(conversationId: string, id: string) {
  if (isConversationDeleting(conversationId))
    return
  const item = usePendingMessagesStore.getState().itemsByConversation[conversationId]?.find(candidate => candidate.id === id)
  if (!item)
    return

  try {
    const result = await submitPendingItem(conversationId, item.text, item.delivery)
    if (result.kind === 'next-turn') {
      toast.info('该消息会在当前任务结束后作为新一轮发送')
      return
    }
    removePendingMessage(conversationId, id)
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : '追加消息失败')
  }
}

export function drainPendingMessages(conversationId: string): Promise<void> {
  if (isConversationDeleting(conversationId))
    return Promise.resolve()
  const existing = drainPromises.get(conversationId)
  if (existing)
    return existing

  const promise = runConversationOperation(conversationId, () => drainOnce(conversationId))
  drainPromises.set(conversationId, promise)
  const cleanup = () => {
    if (drainPromises.get(conversationId) === promise)
      drainPromises.delete(conversationId)
  }
  void promise.then(cleanup, cleanup)
  return promise
}

async function drainOnce(conversationId: string) {
  if (isConversationDeleting(conversationId))
    return

  const item = sortPendingMessages(usePendingMessagesStore.getState().itemsByConversation[conversationId] ?? [])[0]
  if (!item)
    return

  const conversation = getConversationByIdAction(conversationId)
  if (!conversation) {
    toast.error('当前会话已不存在')
    return
  }

  try {
    const result = await submitPendingItem(conversationId, item.text, item.delivery, conversation.settings)
    if (result.kind === 'next-turn')
      return
    removePendingMessage(conversationId, item.id)
    // Runtime 侧已通过 turnService 发出 message:updated 事件，
    // web UI 会自动收到用户消息，无需手动 upsert 会话
  }
  catch (error) {
    // 失败时保留消息，让用户决定重试或手动删除
    toast.error(error instanceof Error ? error.message : '发送消息失败')
  }
}

async function submitPendingItem(
  conversationId: string,
  text: string,
  delivery: 'steering' | 'next-turn',
  settings = getConversationByIdAction(conversationId)?.settings,
) {
  if (!settings)
    throw new Error('当前会话已不存在')
  return submitTurnIntake({
    origin: 'pending',
    delivery,
    conversationId,
    messageContent: [{ type: 'text', text }],
    workspacePath: useWorkspaceStore.getState().currentWorkspacePath,
    settings,
    mode: useChatSttingsStore.getState().agentMode,
  })
}

export {
  clearAllPendingMessages,
  clearConversationPendingMessages,
  editPendingMessage,
  enqueuePendingMessage,
  enqueueVisualizationNextTurn,
  removePendingMessage,
}

function isConversationDeleting(conversationId: string) {
  return (deletionBarriers.get(conversationId)?.size ?? 0) > 0
}

function releaseDeletionOwner(token: PendingMessageDeletionToken, conversationId: string) {
  if (!token.conversationIds.includes(conversationId))
    return false
  const owners = deletionBarriers.get(conversationId)
  if (!owners?.delete(token.owner))
    return false
  if (owners.size === 0)
    deletionBarriers.delete(conversationId)
  return true
}

function runConversationOperation(conversationId: string, operation: () => Promise<void>): Promise<void> {
  const previous = operationPromises.get(conversationId) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  operationPromises.set(conversationId, current)
  const cleanup = () => {
    if (operationPromises.get(conversationId) === current)
      operationPromises.delete(conversationId)
  }
  void current.then(cleanup, cleanup)
  return current
}
