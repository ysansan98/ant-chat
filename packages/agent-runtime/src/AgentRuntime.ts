import type { AgentRuntimeConfig, AgentTaskSnapshot, ApprovePendingActionOptions, CancelTaskOptions, RejectPendingActionOptions } from '@ant-chat/shared'
import type { AgentRuntimeStartOptions } from './types'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { createAgentLogger } from './agentLogger'
import { runAgentLoop } from './agentLoop'
import { createApprovalController } from './approvalController'
import { taskStore } from './taskStore'

export class AgentRuntime {
  private config: AgentRuntimeConfig
  private approvalController: ReturnType<typeof createApprovalController>
  private agentLogger: ReturnType<typeof createAgentLogger>

  constructor(config: AgentRuntimeConfig) {
    this.config = config
    this.approvalController = createApprovalController(config.eventEmitter)
    this.agentLogger = createAgentLogger(config.pathProvider)
  }

  async startTask(options: AgentRuntimeStartOptions) {
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
    const mode = options.mode ?? 'hybrid'
    const workspacePath = options.workspacePath ?? process.cwd()

    const snapshot: AgentTaskSnapshot = {
      taskId,
      conversationId: options.conversationId,
      userMessageId: options.userMessageId,
      workspacePath,
      mode,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      checkpointPath: '',
      logPath: '',
      prompt: options.prompt,
    }

    taskStore.create({ snapshot, abortController: new AbortController() })
    snapshot.logPath = await this.agentLogger.appendAgentLog(options.conversationId, options.userMessageId, 'task_started', {
      conversationId: options.conversationId,
      userMessageId: options.userMessageId,
      mode,
      workspacePath,
    })
    this.config.eventEmitter.emitTaskUpdated(snapshot)
    void runAgentLoop({
      taskId,
      options,
      config: this.config,
      appendAgentLog: this.agentLogger.appendAgentLog,
      approvalController: this.approvalController,
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
      throw new Error('AGENT_TASK_NOT_FOUND')
    return task.snapshot
  }

  listActiveTasks(conversationId?: string) {
    return taskStore.listActive(conversationId)
  }
}
