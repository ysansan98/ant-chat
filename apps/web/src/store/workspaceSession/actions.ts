import type { ConversationsId } from '@ant-chat/shared'
import chatApi from '@/api/chatApi'
import workspaceApi from '@/api/workspaceApi'
import { useAgentRuntimeStore } from '@/store/agentRuntime'
import {
  ensureWorkspaceConversationsAction,
  nextPageConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { useWorkspaceStore } from '@/store/workspace'
import {
  activateConversationSession,
} from './conversationSession'

export interface ActivateWorkspaceSessionOptions {
  workspacePath: string
  conversationId?: ConversationsId | string
}

let activationQueue = Promise.resolve()

/**
 * 原子激活工作区及其会话投影。
 *
 * 该 seam 拥有持久化当前工作区、conversation slice、messages 与 runtime
 * 的调用顺序；任一步骤失败都会恢复调用前的前端投影，并尽力恢复后端当前工作区。
 */
export function activateWorkspaceSession(options: ActivateWorkspaceSessionOptions): Promise<void> {
  const activation = activationQueue.catch(() => {}).then(() => activateWorkspaceSessionOnce(options))
  activationQueue = activation
  return activation
}

/** 从持久化会话定位工作区并完成完整激活，供搜索等只持有 conversationId 的入口使用。 */
export async function activatePersistedConversationSession(conversationId: ConversationsId | string): Promise<void> {
  const conversation = await chatApi.getConversationById(conversationId)
  if (!conversation.workspacePath)
    throw new Error('会话缺少工作区路径')
  await activateWorkspaceSession({
    workspacePath: conversation.workspacePath,
    conversationId,
  })
}

async function activateWorkspaceSessionOnce(options: ActivateWorkspaceSessionOptions): Promise<void> {
  const { workspacePath, conversationId = '' } = options
  if (!workspacePath)
    return

  const previousWorkspace = useWorkspaceStore.getState()
  const previousConversations = useConversationsStore.getState()
  const previousAgentRuntime = useAgentRuntimeStore.getState()
  let persisted = false

  try {
    const workspaceData = await workspaceApi.openWorkspace(workspacePath)
    persisted = true
    useWorkspaceStore.setState({ workspaceData, currentWorkspacePath: workspacePath })

    await ensureWorkspaceConversationsAction(workspacePath)
    useConversationsStore.getState().switchWorkspaceSlice(workspacePath)

    const nextState = useConversationsStore.getState()
    if (nextState.conversations.length === 0 && nextState.conversationsTotal > 0)
      await nextPageConversationsAction()

    await activateConversationSession(conversationId as ConversationsId)
  }
  catch (error) {
    if (persisted && previousWorkspace.currentWorkspacePath) {
      try {
        await workspaceApi.openWorkspace(previousWorkspace.currentWorkspacePath)
      }
      catch {
        // 后端恢复失败不能覆盖真正的激活错误；前端投影仍必须恢复一致。
      }
    }
    const currentConversationStates = useConversationsStore.getState().conversationStates
    useWorkspaceStore.setState(previousWorkspace)
    useConversationsStore.setState({
      ...previousConversations,
      conversationStates: restoreTargetRecord(
        currentConversationStates,
        previousConversations.conversationStates,
        conversationId,
      ),
    })
    restoreConversationRuntime(conversationId, previousAgentRuntime)
    throw error
  }
}

function restoreConversationRuntime(
  conversationId: ConversationsId | string,
  previous: ReturnType<typeof useAgentRuntimeStore.getState>,
): void {
  if (!conversationId)
    return
  const current = useAgentRuntimeStore.getState()
  const previousTasks = Object.fromEntries(
    Object.entries(previous.tasks).filter(([, task]) => task.conversationId === conversationId),
  )
  const currentTaskIds = Object.values(current.tasks)
    .filter(task => task.conversationId === conversationId)
    .map(task => task.taskId)
  const previousTaskIds = Object.keys(previousTasks)
  const affectedTaskIds = new Set([...currentTaskIds, ...previousTaskIds])
  const affectedTurnIds = new Set([
    ...currentTaskIds.map(taskId => current.tasks[taskId]?.userMessageId).filter(Boolean),
    ...previousTaskIds.map(taskId => previous.tasks[taskId]?.userMessageId).filter(Boolean),
  ])

  const tasks = Object.fromEntries(
    Object.entries(current.tasks).filter(([, task]) => task.conversationId !== conversationId),
  )
  const pendingByTask = Object.fromEntries(
    Object.entries(current.pendingByTask).filter(([taskId]) => !affectedTaskIds.has(taskId)),
  )
  const executionPhaseByTurn = Object.fromEntries(
    Object.entries(current.executionPhaseByTurn).filter(([turnId]) => !affectedTurnIds.has(turnId)),
  )

  useAgentRuntimeStore.setState({
    tasks: { ...tasks, ...previousTasks },
    pendingByTask: {
      ...pendingByTask,
      ...Object.fromEntries(Object.entries(previous.pendingByTask).filter(([taskId]) => previousTaskIds.includes(taskId))),
    },
    executionPhaseByTurn: {
      ...executionPhaseByTurn,
      ...Object.fromEntries(Object.entries(previous.executionPhaseByTurn).filter(([turnId]) => affectedTurnIds.has(turnId))),
    },
  })
}

function restoreTargetRecord<T>(
  current: Record<string, T>,
  previous: Record<string, T>,
  targetId: string,
): Record<string, T> {
  const restored = { ...current }
  if (targetId in previous)
    restored[targetId] = previous[targetId]
  else
    delete restored[targetId]
  return restored
}
