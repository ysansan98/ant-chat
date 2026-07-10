import type { AgentRuntimeConfig, AgentRuntimeOptions, AgentRuntimeStartTaskOptions, AgentRuntimeStartTaskResult, AgentTaskSnapshot, ApprovePendingActionOptions, CancelTaskOptions, IMessage, LoopMessage, RejectPendingActionOptions } from '@ant-chat/shared'
import type { BeforeTurnResult, RuntimeStartInput, RuntimeStartResult } from './session/types'
import type { ToolAuthorization } from './tools/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from './AgentError'
import { runAgentLoop } from './loop/agentLoop'
import { createApprovalController } from './policy/approvalController'
import { createToolAuthorization } from './policy/toolAuthorization'
import { SessionRuntime } from './session/SessionRuntime'
import { TaskStore } from './taskStore'

export class AgentRuntime {
  private config: AgentRuntimeConfig
  private approvalController: ReturnType<typeof createApprovalController>
  private beforeToolExecuteHook: ToolAuthorization
  private sessionRuntime: SessionRuntime
  private readonly taskStore = new TaskStore()

  constructor(config: AgentRuntimeConfig) {
    this.config = config
    this.approvalController = createApprovalController(config.eventEmitter, this.taskStore)
    this.beforeToolExecuteHook = createToolAuthorization(
      this.approvalController.waitForApproval,
      config.getToolApprovalWhitelistEntries,
    )
    this.sessionRuntime = new SessionRuntime(config, this.taskStore, async (input, runtime) => {
      return this.startLoopTask(input, runtime)
    })
  }

  async startTask(options: AgentRuntimeStartTaskOptions): Promise<AgentRuntimeStartTaskResult>
  async startTask(
    options: RuntimeStartInput,
    runtime?: {
      eventEmitter?: AgentRuntimeConfig['eventEmitter']
      onBeforeTurn?: (ctx: { messages: LoopMessage[], step: number }) => Promise<BeforeTurnResult>
    },
  ): Promise<RuntimeStartResult>
  async startTask(
    options: RuntimeStartInput | AgentRuntimeStartTaskOptions,
    runtime?: {
      eventEmitter?: AgentRuntimeConfig['eventEmitter']
      onBeforeTurn?: (ctx: { messages: LoopMessage[], step: number }) => Promise<BeforeTurnResult>
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
      onBeforeTurn?: (ctx: { messages: LoopMessage[], step: number }) => Promise<BeforeTurnResult>
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

    const now = Date.now()
    const taskId = randomUUID()

    // 合并 runtime 提供的 eventEmitter 和 contextTraceCapture，以及 options 透传的 taskLogger
    const needMerge = runtime?.eventEmitter || options.taskLogger || options.contextTraceCapture
    const config = needMerge
      ? {
          ...this.config,
          ...(runtime?.eventEmitter ? { eventEmitter: runtime.eventEmitter } : {}),
          ...(options.taskLogger ? { taskLogger: options.taskLogger } : {}),
          ...(options.contextTraceCapture ? { contextTraceCapture: options.contextTraceCapture } : {}),
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
      executionPhase: 'waiting_model',
      createdAt: now,
      updatedAt: now,
      logPath,
      prompt: options.prompt,
      turnSource: options.turnSource,
    }

    const task = { snapshot, abortController: new AbortController(), steeringQueue: [], pendingSteeringMessages: [] }
    this.taskStore.create(task)
    await config.eventEmitter.emitTaskUpdated(snapshot)
    void runAgentLoop({
      task,
      dequeueSteeringInputs: () => this.taskStore.dequeueSteeringInputs(taskId),
      finishTask: () => this.taskStore.finish(taskId),
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

  async injectSteering(conversationId: string, text: string): Promise<IMessage> {
    return await this.sessionRuntime.injectSteering(conversationId, text)
  }

  getTask(taskId: string) {
    const task = this.taskStore.get(taskId)
    if (!task)
      throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')
    return task.snapshot
  }

  listActiveTasks(conversationId?: string) {
    return this.taskStore.listActive(conversationId)
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

  async closeConversation(conversationId: string): Promise<void> {
    await this.sessionRuntime.closeConversation(conversationId)
  }

  async dispose(): Promise<void> {
    await this.sessionRuntime.dispose()
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime({
    ...options.host,
    ...options.overrides,
  })
}

function isSessionStartOptions(
  options: RuntimeStartInput | AgentRuntimeStartTaskOptions,
): options is AgentRuntimeStartTaskOptions {
  return 'model' in options
}

function requireSessionStore(config: AgentRuntimeConfig) {
  if (!config.sessionStore) {
    throw new Error('AgentRuntime missing required config: sessionStore')
  }
  return config.sessionStore
}
