import type { AgentTaskSnapshot } from '@ant-chat/shared'

export interface RuntimeTask {
  snapshot: AgentTaskSnapshot
  abortController: AbortController
  pendingResolver?: (value: { approved: boolean, reason?: string }) => void
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

  finish(taskId: string) {
    const task = this.tasks.get(taskId)
    if (!task)
      return
    this.activeByConversation.delete(task.snapshot.conversationId)
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
