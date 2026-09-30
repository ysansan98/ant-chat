import type {
  AgentMode,
  AgentTaskSnapshot,
  AgentTurnResult,
  AppPendingMessageSnapshot,
  ApprovePendingActionOptions,
  IMessage,
  RejectPendingActionOptions,
  StartAgentTurnOptions,
} from '@ant-chat/shared'
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

async function updateTaskMode(taskId: string, mode: AgentMode): Promise<AgentTaskSnapshot | null> {
  return getAppRpcClient().call('agent.updateTaskMode', { taskId, mode })
}

async function listActiveTasks(conversationId?: string): Promise<AgentTaskSnapshot[]> {
  return getAppRpcClient().call('agent.listActiveTasks', { conversationId })
}

async function injectSteering(conversationId: string, text: string): Promise<IMessage> {
  return getAppRpcClient().call('agent.injectSteering', { conversationId, text })
}

async function listPendingMessages(conversationId: string): Promise<AppPendingMessageSnapshot> {
  return getAppRpcClient().call('agent.listPendingMessages', { conversationId })
}

async function editPendingMessage(conversationId: string, id: string, text: string): Promise<AppPendingMessageSnapshot> {
  return getAppRpcClient().call('agent.editPendingMessage', { conversationId, id, text })
}

async function removePendingMessage(conversationId: string, id: string): Promise<AppPendingMessageSnapshot> {
  return getAppRpcClient().call('agent.removePendingMessage', { conversationId, id })
}

async function steerPendingMessage(conversationId: string, id: string): Promise<{ message: IMessage, snapshot: AppPendingMessageSnapshot }> {
  return getAppRpcClient().call('agent.steerPendingMessage', { conversationId, id })
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
  updateTaskMode,
  injectSteering,
  listActiveTasks,
  listPendingMessages,
  editPendingMessage,
  removePendingMessage,
  steerPendingMessage,
  resolveSecretRequest,
  rejectSecretRequest,
}
