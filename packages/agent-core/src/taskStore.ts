import type { AgentTaskSnapshot } from '@ant-chat/shared'

export interface SteeringInput {
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
  pendingResolver?: (value: { approved: boolean, reason?: string }) => void
  steeringQueue: SteeringInput[]
  pendingSteeringMessages: PendingSteeringMessage[]
}

export class TaskStore {
  private readonly tasks = new Map<string, RuntimeTask>()
  private readonly activeByConversation = new Map<string, string>()

  create(task: RuntimeTask) {
    if (this.activeByConversation.has(task.snapshot.conversationId)) {
      throw new Error('AGENT_TASK_ALREADY_RUNNING')
    }
    this.tasks.set(task.snapshot.taskId, task)
    this.activeByConversation.set(task.snapshot.conversationId, task.snapshot.taskId)
  }

  get(taskId: string) {
    return this.tasks.get(taskId)
  }

  listActive(conversationId?: string): AgentTaskSnapshot[] {
    return [...this.tasks.values()]
      .map(item => item.snapshot)
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

  finish(taskId: string) {
    const task = this.tasks.get(taskId)
    if (!task)
      return
    this.activeByConversation.delete(task.snapshot.conversationId)
    this.tasks.delete(taskId)
  }

  delete(taskId: string) {
    const task = this.tasks.get(taskId)
    if (!task)
      return
    this.activeByConversation.delete(task.snapshot.conversationId)
    this.tasks.delete(taskId)
  }
}

export const taskStore = new TaskStore()
