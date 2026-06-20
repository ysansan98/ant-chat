import type { AgentTaskSnapshot, AgentTurnResult, ApprovePendingActionOptions, IMessage, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

async function startTurn(options: StartAgentTurnOptions): Promise<AgentTurnResult> {
  return getAppRpcClient().call('agent.startTurn', { options })
}

async function approvePendingAction(options: ApprovePendingActionOptions): Promise<null> {
  return getAppRpcClient().call('agent.approvePendingAction', { options })
}

async function rejectPendingAction(options: RejectPendingActionOptions): Promise<null> {
  return getAppRpcClient().call('agent.rejectPendingAction', { options })
}

async function cancelTask(taskId: string): Promise<null> {
  return getAppRpcClient().call('agent.cancelTask', { taskId })
}

async function listActiveTasks(conversationId?: string): Promise<AgentTaskSnapshot[]> {
  return getAppRpcClient().call('agent.listActiveTasks', { conversationId })
}

async function approvePendingActionWithWhitelist(
  options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string },
): Promise<null> {
  return getAppRpcClient().call('agent.approvePendingActionWithWhitelist', { options })
}

async function injectSteering(conversationId: string, text: string): Promise<IMessage> {
  return getAppRpcClient().call('agent.injectSteering', { conversationId, text })
}

async function resolveSecretRequest(options: { requestId: string, value?: string, values?: Record<string, string> }): Promise<null> {
  return getAppRpcClient().call('agent.resolveSecretRequest', { options })
}

async function rejectSecretRequest(options: { requestId: string, reason?: string }): Promise<null> {
  return getAppRpcClient().call('agent.rejectSecretRequest', { options })
}

export default {
  startTurn,
  approvePendingAction,
  rejectPendingAction,
  cancelTask,
  injectSteering,
  listActiveTasks,
  approvePendingActionWithWhitelist,
  resolveSecretRequest,
  rejectSecretRequest,
}
