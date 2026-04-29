import type { ApprovePendingActionOptions, CancelTaskOptions, RejectPendingActionOptions } from '@ant-chat/shared'
import type { RuntimeTask } from './taskStore'
import { reportTaskState } from './progressReporter'
import { taskStore } from './taskStore'

export interface ApprovalDecision {
  approved: boolean
  reason?: string
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export async function approvePendingAction(options: ApprovePendingActionOptions) {
  const task = getApprovableTask(options.taskId, options.actionId)
  task.snapshot.pendingAction = undefined
  task.snapshot.status = 'running'
  task.pendingResolver?.({ approved: true })
  task.pendingResolver = undefined
  reportTaskState(task.snapshot)
}

export async function rejectPendingAction(options: RejectPendingActionOptions) {
  const task = getApprovableTask(options.taskId, options.actionId)
  task.snapshot.pendingAction = undefined
  task.snapshot.status = 'running'
  task.pendingResolver?.({ approved: false, reason: options.reason })
  task.pendingResolver = undefined
  reportTaskState(task.snapshot)
}

export async function cancelTask(options: CancelTaskOptions) {
  const task = taskStore.get(options.taskId)
  if (!task)
    throw new Error('AGENT_TASK_NOT_FOUND')
  task.abortController.abort()
  task.snapshot.status = 'cancelled'
  task.snapshot.pendingAction = undefined
  task.pendingResolver?.({ approved: false, reason: 'AGENT_CANCELLED' })
  task.pendingResolver = undefined
  reportTaskState(task.snapshot)
}

export async function waitForApproval(task: RuntimeTask): Promise<ApprovalDecision> {
  const decision = await new Promise<ApprovalDecision>((resolve, reject) => {
    task.pendingResolver = resolve
    setTimeout(() => {
      if (task.snapshot.status === 'awaiting_approval') {
        reject(new Error('AGENT_APPROVAL_TIMEOUT'))
      }
    }, APPROVAL_TIMEOUT_MS)
  })
  task.pendingResolver = undefined
  return decision
}

function getApprovableTask(taskId: string, actionId: string): RuntimeTask {
  const task = taskStore.get(taskId)
  if (!task)
    throw new Error('AGENT_TASK_NOT_FOUND')
  if (task.snapshot.status !== 'awaiting_approval' || !task.snapshot.pendingAction)
    throw new Error('AGENT_TASK_NOT_APPROVABLE')
  if (task.snapshot.pendingAction.actionId !== actionId)
    throw new Error('AGENT_APPROVAL_ACTION_MISMATCH')
  return task
}
