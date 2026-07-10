import type { AgentRuntimeConfig, AgentRuntimeOptions, AgentRuntimeStartTaskOptions, AgentRuntimeStartTaskResult, AgentTaskSnapshot, ApprovePendingActionOptions, CancelTaskOptions, IMessage, LoopMessage, RejectPendingActionOptions } from '@ant-chat/shared'
import type { BeforeTurnResult, RuntimeStartInput, RuntimeStartResult } from './session/types'
import type { ToolAuthorization } from './tools/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from './AgentError'
import { runAgentLoop } from './loop/agentLoop'
import { createToolAuthorization } from './policy/toolAuthorization'
import { SessionRuntime } from './session/SessionRuntime'
import { TaskStore } from './taskStore'

export class AgentRuntime {
  private config: AgentRuntimeConfig
  private beforeToolExecuteHook: ToolAuthorization
  private sessionRuntime: SessionRuntime
  private readonly taskStore = new TaskStore()

  constructor(config: AgentRuntimeConfig) {
    this.config = config
    this.beforeToolExecuteHook = createToolAuthorization(
      this.taskStore.waitForApproval.bind(this.taskStore),
      config.getToolApprovalWhitelistEntries,
    )
    this.sessionRuntime = new SessionRuntime(config, this.taskStore)
  }

  async startSessionTask(options: AgentRuntimeStartTaskOptions): Promise<AgentRuntimeStartTaskResult> {
    const prepared = await this.sessionRuntime.prepareTask(options)
    const task = await this.startPreparedTask(prepared.input, { eventEmitter: prepared.eventEmitter })
    return { ...task, conversationId: options.conversationId, userMessageId: options.userMessageId, conversation: prepared.conversation! }
  }

  async startPreparedTask(
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
    const task = this.taskStore.approve(options.taskId, options.actionId)
    void this.config.eventEmitter.emitTaskUpdated(task.snapshot)
  }

  rejectPendingAction(options: RejectPendingActionOptions): void {
    const task = this.taskStore.reject(options.taskId, options.actionId, options.reason)
    void this.config.eventEmitter.emitTaskUpdated(task.snapshot)
  }

  cancelTask(options: CancelTaskOptions): void {
    const task = this.taskStore.cancel(options.taskId)
    void this.config.eventEmitter.emitTaskUpdated(task.snapshot)
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

function requireSessionStore(config: AgentRuntimeConfig) {
  if (!config.sessionStore) {
    throw new Error('AgentRuntime missing required config: sessionStore')
  }
  return config.sessionStore
}
