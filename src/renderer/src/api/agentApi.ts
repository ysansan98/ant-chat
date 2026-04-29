import type { AgentTaskResult, AgentTaskSnapshot, ApprovePendingActionOptions, IpcResponse, RejectPendingActionOptions, StartAgentTaskOptions } from '@ant-chat/shared'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'

async function startTask(options: StartAgentTaskOptions): Promise<AgentTaskResult> {
  return unwrapIpcResponse(await ipc.agent.startTask(options) as IpcResponse<AgentTaskResult>)
}

async function approvePendingAction(options: ApprovePendingActionOptions): Promise<null> {
  return unwrapIpcResponse(await ipc.agent.approvePendingAction(options))
}

async function rejectPendingAction(options: RejectPendingActionOptions): Promise<null> {
  return unwrapIpcResponse(await ipc.agent.rejectPendingAction(options))
}

async function cancelTask(taskId: string): Promise<null> {
  return unwrapIpcResponse(await ipc.agent.cancelTask({ taskId }))
}

async function listActiveTasks(conversationId?: string): Promise<AgentTaskSnapshot[]> {
  return unwrapIpcResponse(await ipc.agent.listActiveTasks(conversationId))
}

export default {
  startTask,
  approvePendingAction,
  rejectPendingAction,
  cancelTask,
  listActiveTasks,
}
