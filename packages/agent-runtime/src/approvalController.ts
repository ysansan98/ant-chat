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
      // 取消操作时任务不存在
      throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')
    task.abortController.abort()
    task.snapshot.status = 'cancelled'
    task.snapshot.pendingAction = undefined
    task.pendingResolver?.({ approved: false, reason: 'AGENT_CANCELLED' })
    task.pendingResolver = undefined
    eventEmitter.emitTaskUpdated(task.snapshot)
  }

  function waitForApproval(task: RuntimeTask): Promise<ApprovalDecision> {
    let timer: ReturnType<typeof setTimeout>
    return new Promise<ApprovalDecision>((resolve, reject) => {
      task.pendingResolver = (decision: ApprovalDecision) => {
        clearTimeout(timer)
        resolve(decision)
      }
      timer = setTimeout(() => {
        if (task.snapshot.status === 'awaiting_approval') {
          task.pendingResolver = undefined
          // 审批等待超时（5 分钟）
          reject(new AgentError('AGENT_APPROVAL_TIMEOUT', 'Approval timeout'))
        }
      }, APPROVAL_TIMEOUT_MS)
    })
  }

  return { approvePendingAction, rejectPendingAction, cancelTask, waitForApproval }
}

function getApprovableTask(taskId: string, actionId: string): RuntimeTask {
  const task = taskStore.get(taskId)
  if (!task)
    throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')
  if (task.snapshot.status !== 'awaiting_approval' || !task.snapshot.pendingAction)
    throw new AgentError('AGENT_TASK_NOT_APPROVABLE', 'Task is not awaiting approval')
  if (task.snapshot.pendingAction.actionId !== actionId)
    throw new AgentError('AGENT_APPROVAL_ACTION_MISMATCH', 'Approval action mismatch')
  return task
}
