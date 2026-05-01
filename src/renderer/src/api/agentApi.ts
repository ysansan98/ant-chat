import type { AgentTaskSnapshot, AgentTurnResult, ApprovePendingActionOptions, IpcResponse, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'

async function startTurn(options: StartAgentTurnOptions): Promise<AgentTurnResult> {
  return unwrapIpcResponse(await ipc.agent.startTurn(options) as IpcResponse<AgentTurnResult>)
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
  startTurn,
  approvePendingAction,
  rejectPendingAction,
  cancelTask,
  listActiveTasks,
}
