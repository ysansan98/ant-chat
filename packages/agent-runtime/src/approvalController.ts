import type { ApprovePendingActionOptions, CancelTaskOptions, IAgentEventEmitter, RejectPendingActionOptions } from '@ant-chat/shared'
import type { RuntimeTask } from './taskStore'
import { AgentError } from './AgentError'
import { taskStore } from './taskStore'

export interface ApprovalDecision {
  approved: boolean
  reason?: string
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export function createApprovalController(eventEmitter: IAgentEventEmitter) {
  function approvePendingAction(options: ApprovePendingActionOptions) {
    const task = getApprovableTask(options.taskId, options.actionId)
    task.snapshot.pendingAction = undefined
    task.snapshot.status = 'running'
    task.pendingResolver?.({ approved: true })
    task.pendingResolver = undefined
    eventEmitter.emitTaskUpdated(task.snapshot)
  }

  function rejectPendingAction(options: RejectPendingActionOptions) {
    const task = getApprovableTask(options.taskId, options.actionId)
    task.snapshot.pendingAction = undefined
    task.snapshot.status = 'running'
    task.pendingResolver?.({ approved: false, reason: options.reason })
    task.pendingResolver = undefined
    eventEmitter.emitTaskUpdated(task.snapshot)
  }

  function cancelTask(options: CancelTaskOptions) {
    const task = taskStore.get(options.taskId)
    if (!task)
      throw new AgentError('AGENT_TASK_NOT_FOUND', '任务未找到')
    task.abortController.abort()
    task.snapshot.status = 'cancelled'
    task.snapshot.pendingAction = undefined
    task.pendingResolver?.({ approved: false, reason: 'AGENT_CANCELLED' })
    task.pendingResolver = undefined
    eventEmitter.emitTaskUpdated(task.snapshot)
  }

  function waitForApproval(task: RuntimeTask): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve, reject) => {
      task.pendingResolver = resolve
      setTimeout(() => {
        if (task.snapshot.status === 'awaiting_approval') {
          reject(new AgentError('AGENT_APPROVAL_TIMEOUT', '审批等待超时'))
        }
      }, APPROVAL_TIMEOUT_MS)
    })
  }

  return { approvePendingAction, rejectPendingAction, cancelTask, waitForApproval }
}

function getApprovableTask(taskId: string, actionId: string): RuntimeTask {
  const task = taskStore.get(taskId)
  if (!task)
    throw new AgentError('AGENT_TASK_NOT_FOUND', '任务未找到')
  if (task.snapshot.status !== 'awaiting_approval' || !task.snapshot.pendingAction)
    throw new AgentError('AGENT_TASK_NOT_APPROVABLE', '任务不在等待审批状态')
  if (task.snapshot.pendingAction.actionId !== actionId)
    throw new AgentError('AGENT_APPROVAL_ACTION_MISMATCH', '审批操作不匹配')
  return task
}
