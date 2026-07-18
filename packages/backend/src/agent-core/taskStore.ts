import type { AgentPendingAction, AgentTaskSnapshot, IAgentEventEmitter } from '@ant-chat/shared'
import { AgentError } from './AgentError'

export interface SteeringInput {
  messageId: string
  text: string
  turnId: string
}

export interface PendingSteeringMessage {
  id: string
  text: string
  turnId: string
}

export interface RuntimeTask {
  snapshot: AgentTaskSnapshot
  abortController: AbortController
}

export interface TaskExecution {
  task: RuntimeTask
  dequeueSteeringInputs: () => SteeringInput[]
  finish: () => void
}

interface StoredTask extends RuntimeTask {
  pendingResolver?: (value: { approved: boolean, reason?: string }) => void
  steeringQueue: SteeringInput[]
  pendingSteeringMessages: PendingSteeringMessage[]
}

export interface ApprovalDecision {
  approved: boolean
  reason?: string
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export class TaskStore {
  private readonly tasks = new Map<string, StoredTask>()
  private readonly activeByConversation = new Map<string, string>()

  reserve(task: RuntimeTask): TaskExecution {
    if (this.activeByConversation.has(task.snapshot.conversationId)) {
      throw new Error('AGENT_TASK_ALREADY_RUNNING')
    }
    this.tasks.set(task.snapshot.taskId, {
      ...task,
      steeringQueue: [],
      pendingSteeringMessages: [],
    })
    this.activeByConversation.set(task.snapshot.conversationId, task.snapshot.taskId)
    return {
      task,
      dequeueSteeringInputs: () => this.dequeueSteeringInputs(task.snapshot.taskId),
      finish: () => this.finish(task.snapshot.taskId),
    }
  }

  getSnapshot(taskId: string): AgentTaskSnapshot | undefined {
    const task = this.tasks.get(taskId)
    return task ? { ...task.snapshot } : undefined
  }

  listActive(conversationId?: string): AgentTaskSnapshot[] {
    return [...this.tasks.values()]
      .map(item => ({ ...item.snapshot }))
      .filter(item => ['running', 'awaiting_approval'].includes(item.status))
      .filter(item => !conversationId || item.conversationId === conversationId)
  }

  enqueueSteeringInput(taskId: string, input: SteeringInput) {
    const task = this.tasks.get(taskId)
    if (!task)
      return
    task.steeringQueue.push(input)
  }

  dequeueSteeringInputs(taskId: string): SteeringInput[] {
    const task = this.tasks.get(taskId)
    if (!task || task.steeringQueue.length === 0)
      return []
    const inputs = [...task.steeringQueue]
    task.steeringQueue = []
    return inputs
  }

  enqueueSteeringMessage(taskId: string, message: PendingSteeringMessage): void {
    const task = this.tasks.get(taskId)
    if (task) {
      task.pendingSteeringMessages.push(message)
    }
  }

  takePendingSteeringMessages(taskId: string): PendingSteeringMessage[] {
    const task = this.tasks.get(taskId)
    if (!task || task.pendingSteeringMessages.length === 0)
      return []
    const messages = [...task.pendingSteeringMessages]
    task.pendingSteeringMessages = []
    return messages
  }

  approve(taskId: string, actionId: string): RuntimeTask {
    const task = this.getApprovableTask(taskId, actionId)
    task.snapshot.pendingAction = undefined
    task.snapshot.status = 'running'
    task.pendingResolver?.({ approved: true })
    task.pendingResolver = undefined
    return task
  }

  reject(taskId: string, actionId: string, reason?: string): RuntimeTask {
    const task = this.getApprovableTask(taskId, actionId)
    task.snapshot.pendingAction = undefined
    task.snapshot.status = 'running'
    task.pendingResolver?.({ approved: false, reason })
    task.pendingResolver = undefined
    return task
  }

  cancel(taskId: string): RuntimeTask {
    const task = this.tasks.get(taskId)
    if (!task)
      throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')
    task.abortController.abort()
    task.snapshot.status = 'cancelled'
    task.snapshot.pendingAction = undefined
    task.pendingResolver?.({ approved: false, reason: 'AGENT_CANCELLED' })
    task.pendingResolver = undefined
    return task
  }

  waitForApproval(task: RuntimeTask): Promise<ApprovalDecision> {
    const storedTask = this.getStored(task.snapshot.taskId)
    if (!storedTask)
      return Promise.reject(new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found'))
    let timer: ReturnType<typeof setTimeout>
    return new Promise<ApprovalDecision>((resolve, reject) => {
      storedTask.pendingResolver = (decision) => {
        clearTimeout(timer)
        resolve(decision)
      }
      timer = setTimeout(() => {
        if (storedTask.snapshot.status === 'awaiting_approval') {
          storedTask.pendingResolver = undefined
          reject(new AgentError('AGENT_APPROVAL_TIMEOUT', 'Approval timeout'))
        }
      }, APPROVAL_TIMEOUT_MS)
    })
  }

  async requestApproval(task: RuntimeTask, pendingAction: AgentPendingAction, eventEmitter: IAgentEventEmitter): Promise<ApprovalDecision> {
    const storedTask = this.getStored(task.snapshot.taskId)
    if (!storedTask)
      throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')
    storedTask.snapshot.status = 'awaiting_approval'
    storedTask.snapshot.pendingAction = pendingAction
    void eventEmitter.emitTaskUpdated(storedTask.snapshot)
    void eventEmitter.emitApprovalRequired(storedTask.snapshot.taskId, storedTask.snapshot.conversationId, pendingAction)
    return await this.waitForApproval(storedTask)
  }

  finish(taskId: string) {
    const task = this.tasks.get(taskId)
    if (!task)
      return
    this.activeByConversation.delete(task.snapshot.conversationId)
    this.tasks.delete(taskId)
  }

  private getApprovableTask(taskId: string, actionId: string): StoredTask {
    const task = this.tasks.get(taskId)
    if (!task)
      throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')
    if (task.snapshot.status !== 'awaiting_approval' || !task.snapshot.pendingAction)
      throw new AgentError('AGENT_TASK_NOT_APPROVABLE', 'Task is not awaiting approval')
    if (task.snapshot.pendingAction.actionId !== actionId)
      throw new AgentError('AGENT_APPROVAL_ACTION_MISMATCH', 'Approval action mismatch')
    return task
  }

  private getStored(taskId: string): StoredTask | undefined {
    return this.tasks.get(taskId)
  }
}
