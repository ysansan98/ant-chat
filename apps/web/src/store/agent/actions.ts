import type { AgentTaskSnapshot, ApprovePendingActionOptions, RejectPendingActionOptions, SecretRequest, StartAgentTurnOptions } from '@ant-chat/shared'
import agentApi from '@/api/agentApi'
import { addStreamingConversationId, removeStreamingConversationId } from '@/store/conversation'
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

export async function resolveSecretRequestAction(requestId: string, value: string) {
  await agentApi.resolveSecretRequest({ requestId, value })
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

    for (const task of activeTasks) {
      tasks[task.taskId] = task
      if (task.pendingAction)
        pendingByTask[task.taskId] = task.pendingAction
    }

    return { tasks, pendingByTask }
  })

  if (activeTasks.some(isActiveTask))
    addStreamingConversationId(conversationId)
  else
    removeStreamingConversationId(conversationId)
}

export function onAgentStateUpdated(task: Parameters<typeof useAgentStore.getState> extends never ? never : any) {
  useAgentStore.getState().setTask(task)
  if (isActiveTask(task))
    addStreamingConversationId(task.conversationId)
  else
    removeStreamingConversationId(task.conversationId)
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
