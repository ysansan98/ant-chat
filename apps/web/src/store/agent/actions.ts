import type { AgentTaskSnapshot, ApprovePendingActionOptions, RejectPendingActionOptions, SecretRequest, StartAgentTurnOptions } from '@ant-chat/shared'
import agentApi from '@/api/agentApi'
import { setConversationState, removeConversationState, useConversationsStore } from '@/store/conversation'
import { useAgentStore } from './store'

export async function startAgentTurn(options: StartAgentTurnOptions) {
  return await agentApi.startTurn(options)
}

export async function approveAgentAction(options: ApprovePendingActionOptions) {
  await agentApi.approvePendingAction(options)
}

export async function approveAgentActionWithWhitelist(
  options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string },
) {
  await agentApi.approvePendingActionWithWhitelist(options)
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
  useAgentStore.getState().clearSecretRequest(requestId)
}

export async function rejectSecretRequestAction(requestId: string) {
  await agentApi.rejectSecretRequest({ requestId, reason: '用户拒绝' })
  useAgentStore.getState().clearSecretRequest(requestId)
}

export async function syncConversationAgentState(conversationId: string) {
  const activeTasks = await agentApi.listActiveTasks(conversationId)

  const activeTaskIds = new Set(activeTasks.map(task => task.taskId))

  useAgentStore.setState((state) => {
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

  if (activeTasks.some(isActiveTask))
    setConversationState(conversationId, 'running')
  else
    removeConversationState(conversationId)
}

export function onAgentStateUpdated(task: Parameters<typeof useAgentStore.getState> extends never ? never : any) {
  useAgentStore.getState().setTask(task)
  if (isActiveTask(task)) {
    setConversationState(task.conversationId, 'running')
  }
  else {
    // 活跃会话的任务完成 → idle，后台会话 → completed
    const activeId = useConversationsStore.getState().activeConversationsId
    if (task.conversationId === activeId) {
      removeConversationState(task.conversationId)
    }
    else {
      setConversationState(task.conversationId, 'completed')
    }
  }
  if (!task.pendingAction) {
    useAgentStore.getState().setPending(task.taskId, undefined)
  }
}

export function onAgentApprovalRequired(taskId: string, pendingAction: any) {
  useAgentStore.getState().setPending(taskId, pendingAction)
}

export function onAgentSecretRequested(request: SecretRequest) {
  useAgentStore.getState().setSecretRequest(request)
}

function isActiveTask(task: AgentTaskSnapshot) {
  return ['running', 'awaiting_approval'].includes(task.status)
}
