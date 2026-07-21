import type {
  AgentPendingAction,
  AgentTaskSnapshot,
  ApprovePendingActionOptions,
  RejectPendingActionOptions,
  SecretRequest,
  StartAgentTurnOptions,
} from '@ant-chat/shared'
import agentApi from '@/api/agentApi'
import { removeConversationState, setConversationState, useConversationsStore } from '@/store/conversation'
import { isTaskActive } from './predicates'
import { useAgentRuntimeStore } from './store'

// ---- RPC 转发：薄传输层，不承担运行时判定 ----

export async function startAgentTurn(options: StartAgentTurnOptions) {
  return await agentApi.startTurn(options)
}

export async function approveAgentAction(options: ApprovePendingActionOptions) {
  await agentApi.approvePendingAction(options)
}

export async function rejectAgentAction(options: RejectPendingActionOptions) {
  await agentApi.rejectPendingAction(options)
}

export async function cancelAgentTask(taskId: string) {
  await agentApi.cancelTask(taskId)
}

export async function injectSteeringAction(conversationId: string, text: string) {
  return await agentApi.injectSteering(conversationId, text)
}

export async function resolveSecretRequestAction(requestId: string, values: Record<string, string>) {
  await agentApi.resolveSecretRequest({ requestId, values })
  useAgentRuntimeStore.getState().clearSecretRequest(requestId)
}

export async function rejectSecretRequestAction(requestId: string) {
  await agentApi.rejectSecretRequest({ requestId, reason: '用户拒绝' })
  useAgentRuntimeStore.getState().clearSecretRequest(requestId)
}

// ---- 运行时投影：事件对账 + 会话状态派生 ----

/**
 * 从 runtime 拉取会话的活跃任务并对账本地投影。
 *
 * 内部完成：清除本地已不活跃的陈旧任务 / 阶段 / 待审批，写入远程仍在运行的任务，
 * 并据此派生会话 running 状态。调用方无需关心活跃判定规则。
 */
export async function syncConversationRuntime(conversationId: string) {
  const activeTasks = await agentApi.listActiveTasks(conversationId)

  const activeTaskIds = new Set(activeTasks.map(task => task.taskId))

  useAgentRuntimeStore.setState((state) => {
    const tasks = Object.fromEntries(
      Object.entries(state.tasks)
        .filter(([, task]) => task.conversationId !== conversationId),
    )
    const pendingByTask = Object.fromEntries(
      Object.entries(state.pendingByTask)
        .filter(([taskId]) => activeTaskIds.has(taskId) || state.tasks[taskId]?.conversationId !== conversationId),
    )
    const executionPhaseByTurn = { ...state.executionPhaseByTurn }

    for (const task of Object.values(state.tasks)) {
      if (task.conversationId === conversationId)
        delete executionPhaseByTurn[task.userMessageId]
    }

    for (const task of activeTasks) {
      tasks[task.taskId] = task
      executionPhaseByTurn[task.userMessageId] = task.executionPhase ?? 'waiting_model'
      if (task.pendingAction)
        pendingByTask[task.taskId] = task.pendingAction
    }

    return { tasks, pendingByTask, executionPhaseByTurn }
  })

  if (activeTasks.some(isTaskActive))
    setConversationState(conversationId, 'running')
  else
    removeConversationState(conversationId)
}

/**
 * 应用 `agent:task-updated` 事件：更新任务投影并派生会话运行状态。
 *
 * - 活跃任务 → 会话标记 running
 * - 活跃会话的任务转入终态 → 移除 running（回到 idle）
 * - 后台会话的任务转入终态 → 标记 completed
 * - 任务不再携带 pendingAction 时清理对应待审批项
 */
export function applyTaskUpdate(task: AgentTaskSnapshot) {
  useAgentRuntimeStore.getState().setTask(task)
  if (isTaskActive(task)) {
    setConversationState(task.conversationId, 'running')
  }
  else {
    const activeId = useConversationsStore.getState().activeConversationsId
    if (task.conversationId === activeId)
      removeConversationState(task.conversationId)
    else
      setConversationState(task.conversationId, 'completed')
  }
  if (!task.pendingAction)
    useAgentRuntimeStore.getState().setPending(task.taskId, undefined)
}

/** 应用 `agent:approval-required` 事件。 */
export function applyApprovalRequired(taskId: string, pendingAction: AgentPendingAction) {
  useAgentRuntimeStore.getState().setPending(taskId, pendingAction)
}

/** 应用 `agent:secret-requested` 事件。 */
export function applySecretRequest(request: SecretRequest) {
  useAgentRuntimeStore.getState().setSecretRequest(request)
}

/**
 * 取消会话当前活跃任务（若有）。
 *
 * 活跃判定收敛在本模块，调用方只需传入会话 id。
 */
export async function abortConversationRuntime(conversationId: string) {
  const taskList = await agentApi.listActiveTasks(conversationId)
  const activeTask = taskList.find(isTaskActive)
  if (activeTask)
    await agentApi.cancelTask(activeTask.taskId)
}

// ---- 便捷读取（非响应式，基于 getState）----

/** 会话是否存在活跃任务（运行中或等待审批）。 */
export function isRunning(conversationId: string): boolean {
  return useAgentRuntimeStore.getState().getActiveTaskByConversation(conversationId) !== null
}

/** 读取会话的活跃任务，无则返回 null。 */
export function getActiveTask(conversationId: string): AgentTaskSnapshot | null {
  return useAgentRuntimeStore.getState().getActiveTaskByConversation(conversationId)
}
