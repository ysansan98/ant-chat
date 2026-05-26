import type { AgentRuntimeConfig, AgentRuntimeStartTaskOptions, AgentRuntimeStartTaskResult, AgentTaskSnapshot, ApprovePendingActionOptions, CancelTaskOptions, LoopMessage, RejectPendingActionOptions } from '@ant-chat/shared'
import type { BeforeToolExecuteHook } from './loop/types'
import type { RuntimeStartInput, RuntimeStartResult } from './session/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from './AgentError'
import { runAgentLoop } from './loop/agentLoop'
import { taskStore } from './loop/taskStore'
import { createApprovalController } from './policy/approvalController'
import { createBeforeToolExecuteHook } from './policy/beforeToolExecute'
import { SessionRuntime } from './session/SessionRuntime'

export class AgentRuntime {
  private config: AgentRuntimeConfig
  private approvalController: ReturnType<typeof createApprovalController>
  private beforeToolExecuteHook: BeforeToolExecuteHook
  private sessionRuntime: SessionRuntime

  constructor(config: AgentRuntimeConfig) {
    this.config = config
    this.approvalController = createApprovalController(config.eventEmitter)
    this.beforeToolExecuteHook = createBeforeToolExecuteHook(
      this.approvalController.waitForApproval,
      config.getToolApprovalWhitelistEntries,
    )
    this.sessionRuntime = new SessionRuntime(config, this.listActiveTasks.bind(this), async (input, runtime) => {
      return this.startLoopTask(input, runtime)
    })
  }

  async startTask(options: AgentRuntimeStartTaskOptions): Promise<AgentRuntimeStartTaskResult>
  async startTask(
    options: RuntimeStartInput,
    runtime?: {
      eventEmitter?: AgentRuntimeConfig['eventEmitter']
      onBeforeTurn?: (ctx: { messages: LoopMessage[], step: number }) => Promise<{ messages: LoopMessage[] }>
    },
  ): Promise<RuntimeStartResult>
  async startTask(
    options: RuntimeStartInput | AgentRuntimeStartTaskOptions,
    runtime?: {
      eventEmitter?: AgentRuntimeConfig['eventEmitter']
      onBeforeTurn?: (ctx: { messages: LoopMessage[], step: number }) => Promise<{ messages: LoopMessage[] }>
    },
  ): Promise<RuntimeStartResult | AgentRuntimeStartTaskResult> {
    if (isSessionStartOptions(options)) {
      return this.sessionRuntime.startTask(options)
    }
    return this.startLoopTask(options, runtime)
  }

  private async startLoopTask(
    options: RuntimeStartInput,
    runtime?: {
      eventEmitter?: AgentRuntimeConfig['eventEmitter']
      onBeforeTurn?: (ctx: { messages: LoopMessage[], step: number }) => Promise<{ messages: LoopMessage[] }>
    },
  ): Promise<RuntimeStartResult> {
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

    if (this.listActiveTasks(options.conversationId).length > 0) {
      throw new Error('AGENT_TASK_ALREADY_RUNNING')
    }

    const now = Date.now()
    const taskId = randomUUID()

    // 合并 runtime 提供的 eventEmitter，以及 options 透传的 taskLogger
    const needMerge = runtime?.eventEmitter || options.taskLogger
    const config = needMerge
      ? {
          ...this.config,
          ...(runtime?.eventEmitter ? { eventEmitter: runtime.eventEmitter } : {}),
          ...(options.taskLogger ? { taskLogger: options.taskLogger } : {}),
        }
      : this.config

    const logPath = options.taskLogger?.filePath ?? ''

    const snapshot: AgentTaskSnapshot = {
      taskId,
      conversationId: options.conversationId,
      userMessageId: options.userMessageId,
      workspacePath: options.workspacePath,
      mode: options.mode,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      logPath,
      prompt: options.prompt,
    }

    taskStore.create({ snapshot, abortController: new AbortController() })
    await config.eventEmitter.emitTaskUpdated(snapshot)
    void runAgentLoop({
      taskId,
      options,
      config,
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

  listConversations() {
    return requireSessionStore(this.config).listConversations()
  }

  getConversation(id: string) {
    return requireSessionStore(this.config).getConversation(id)
  }

  getMessages(conversationId: string) {
    return requireSessionStore(this.config).getMessages(conversationId)
  }
}

function isSessionStartOptions(
  options: RuntimeStartInput | AgentRuntimeStartTaskOptions,
): options is AgentRuntimeStartTaskOptions {
  return 'modelId' in options
}

function requireSessionStore(config: AgentRuntimeConfig) {
  if (!config.sessionStore) {
    throw new Error('AgentRuntime missing required config: sessionStore')
  }
  return config.sessionStore
}
