import type { AgentRuntimeConfig, AgentTaskSnapshot, ApprovePendingActionOptions, CancelTaskOptions, LoopMessage, RejectPendingActionOptions } from '@ant-chat/shared'
import type { BeforeToolExecuteHook } from './loop/types'
import type { RuntimeStartInput } from './session/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from './AgentError'
import { runAgentLoop } from './loop/agentLoop'
import { taskStore } from './loop/taskStore'
import { createApprovalController } from './policy/approvalController'
import { createBeforeToolExecuteHook } from './policy/beforeToolExecute'

export class AgentRuntime {
  private config: AgentRuntimeConfig
  private approvalController: ReturnType<typeof createApprovalController>
  private beforeToolExecuteHook: BeforeToolExecuteHook

  constructor(config: AgentRuntimeConfig) {
    this.config = config
    this.approvalController = createApprovalController(config.eventEmitter)
    this.beforeToolExecuteHook = createBeforeToolExecuteHook(
      this.approvalController.waitForApproval,
    )
  }

  async startTask(
    options: RuntimeStartInput,
    runtime?: {
      onBeforeTurn?: (ctx: { messages: LoopMessage[], step: number }) => Promise<{ messages: LoopMessage[] }>
    },
  ) {
    const missing: string[] = []
    if (!options.conversationId?.trim())
      missing.push('conversationId')
    if (!options.userMessageId?.trim())
      missing.push('userMessageId')
    if (!options.prompt?.trim())
      missing.push('prompt')
    if (missing.length > 0) {
      throw new Error(`invalid start task options: missing ${missing.join(', ')}`)
    }

    const now = Date.now()
    const taskId = randomUUID()

    const snapshot: AgentTaskSnapshot = {
      taskId,
      conversationId: options.conversationId,
      userMessageId: options.userMessageId,
      workspacePath: options.workspacePath,
      mode: options.mode,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      logPath: '',
      prompt: options.prompt,
    }

    taskStore.create({ snapshot, abortController: new AbortController() })
    this.config.eventEmitter.emitTaskUpdated(snapshot)
    void runAgentLoop({
      taskId,
      options,
      config: this.config,
      onBeforeTurn: runtime?.onBeforeTurn,
      beforeToolExecute: this.beforeToolExecuteHook,
    }).catch(() => {})

    return { taskId }
  }

  approvePendingAction(options: ApprovePendingActionOptions): void {
    this.approvalController.approvePendingAction(options)
  }

  rejectPendingAction(options: RejectPendingActionOptions): void {
    this.approvalController.rejectPendingAction(options)
  }

  cancelTask(options: CancelTaskOptions): void {
    this.approvalController.cancelTask(options)
  }

  getTask(taskId: string) {
    const task = taskStore.get(taskId)
    if (!task)
      throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')
    return task.snapshot
  }

  listActiveTasks(conversationId?: string) {
    return taskStore.listActive(conversationId)
  }
}
