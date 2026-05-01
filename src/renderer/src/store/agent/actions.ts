import type { ApprovePendingActionOptions, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import agentApi from '@/api/agentApi'
import { addStreamingConversationId, removeStreamingConversationId } from '@/store/conversation'
import { useAgentStore } from './store'

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

export function onAgentStateUpdated(task: Parameters<typeof useAgentStore.getState> extends never ? never : any) {
  useAgentStore.getState().setTask(task)
  if (['running', 'awaiting_approval'].includes(task.status))
    addStreamingConversationId(task.conversationId)
  else
    removeStreamingConversationId(task.conversationId)
  if (!task.pendingAction) {
    useAgentStore.getState().setPending(task.taskId, undefined)
  }
}

export function onAgentProgressUpdated(taskId: string, progress: any[]) {
  useAgentStore.getState().setProgress(taskId, progress)
}

export function onAgentApprovalRequired(taskId: string, pendingAction: any) {
  useAgentStore.getState().setPending(taskId, pendingAction)
}
