import type { AgentTaskSnapshot, AgentTurnResult, ApprovePendingActionOptions, IMessage, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

async function startTurn(options: StartAgentTurnOptions): Promise<AgentTurnResult> {
  return (await getAppTransport()).agent.startTurn(options)
}

async function approvePendingAction(options: ApprovePendingActionOptions): Promise<null> {
  return (await getAppTransport()).agent.approvePendingAction(options)
}

async function rejectPendingAction(options: RejectPendingActionOptions): Promise<null> {
  return (await getAppTransport()).agent.rejectPendingAction(options)
}

async function cancelTask(taskId: string): Promise<null> {
  return (await getAppTransport()).agent.cancelTask(taskId)
}

async function listActiveTasks(conversationId?: string): Promise<AgentTaskSnapshot[]> {
  return (await getAppTransport()).agent.listActiveTasks(conversationId)
}

async function approvePendingActionWithWhitelist(
  options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string },
): Promise<null> {
  return (await getAppTransport()).agent.approvePendingActionWithWhitelist(options)
}

async function injectSteering(conversationId: string, text: string): Promise<IMessage> {
  return (await getAppTransport()).agent.injectSteering({ conversationId, text })
}

export default {
  startTurn,
  approvePendingAction,
  rejectPendingAction,
  cancelTask,
  injectSteering,
  listActiveTasks,
  approvePendingActionWithWhitelist,
}
