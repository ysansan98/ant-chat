import type { ApprovePendingActionOptions, CancelTaskOptions, IAgentEventEmitter, RejectPendingActionOptions } from '@ant-chat/shared'
import type { TaskStore } from '../taskStore'

export interface ApprovalDecision {
  approved: boolean
  reason?: string
}

export function createApprovalController(eventEmitter: IAgentEventEmitter, taskStore: TaskStore) {
  function approvePendingAction(options: ApprovePendingActionOptions) {
    const task = taskStore.approve(options.taskId, options.actionId)
    eventEmitter.emitTaskUpdated(task.snapshot)
  }

  function rejectPendingAction(options: RejectPendingActionOptions) {
    const task = taskStore.reject(options.taskId, options.actionId, options.reason)
    eventEmitter.emitTaskUpdated(task.snapshot)
  }

  function cancelTask(options: CancelTaskOptions) {
    const task = taskStore.cancel(options.taskId)
    eventEmitter.emitTaskUpdated(task.snapshot)
  }

  return { approvePendingAction, rejectPendingAction, cancelTask, waitForApproval: taskStore.waitForApproval.bind(taskStore) }
}
