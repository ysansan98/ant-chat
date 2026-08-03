import type { AgentMode, AgentRuntimeConfig, AgentRuntimeOptions, AgentRuntimeStartTaskOptions, AgentRuntimeStartTaskResult, AgentTaskSnapshot, ApprovePendingActionOptions, CancelTaskOptions, IMessage, RejectPendingActionOptions } from '@ant-chat/shared'
import type { RuntimeStartInput, RuntimeStartResult } from './session/types'
import type { ToolAuthorization } from './tools/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from './AgentError'
import { runAgentLoop } from './loop/agentLoop'
import { finishTurnObservation, recordContextObservation } from './observation'
import { rebuildRulesFromApproval } from './policy/approvalRuleRebuilder'
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
      this.taskStore,
      {
        getRules: config.getPermissionRules,
      },
    )
    this.sessionRuntime = new SessionRuntime(config, this.taskStore)
  }

  async startSessionTask(options: AgentRuntimeStartTaskOptions): Promise<AgentRuntimeStartTaskResult> {
    const prepared = await this.sessionRuntime.prepareTask(options)
    const task = await this.startPreparedTask(prepared.input, { eventEmitterFactory: prepared.createEventEmitter })
    return { ...task, conversationId: options.conversationId, userMessageId: options.userMessageId, conversation: prepared.conversation! }
  }

  async startPreparedTask(
    options: RuntimeStartInput,
    runtime?: {
      eventEmitter?: AgentRuntimeConfig['eventEmitter']
      eventEmitterFactory?: (taskId: string) => AgentRuntimeConfig['eventEmitter']
    },
  ): Promise<RuntimeStartResult> {
    const missing: string[] = []
    if (!options.conversationId?.trim())
      missing.push('conversationId')
    if (!options.userMessageId?.trim())
      missing.push('userMessageId')
    if (!options.userText?.trim())
      missing.push('userText')
    if (missing.length > 0) {
      throw new Error(`invalid start task options: missing ${missing.join(', ')}`)
    }

    const now = Date.now()
    const taskId = randomUUID()

    const eventEmitter = runtime?.eventEmitterFactory?.(taskId) ?? runtime?.eventEmitter
    const baseConfig = eventEmitter
      ? {
          ...this.config,
          eventEmitter,
        }
      : this.config

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
      prompt: options.userText,
      turnSource: options.turnSource,
    }

    const task = { snapshot, abortController: new AbortController() }
    const execution = this.taskStore.reserve(task)
    const turnRecorder = beginTurnObservation(baseConfig, {
      conversationId: options.conversationId,
      turnId: options.userMessageId,
      taskId,
      source: options.turnSource ?? { type: 'interactive' },
    })
    const config = turnRecorder ? { ...baseConfig, turnRecorder } : baseConfig
    for (const event of options.preTurnContextEvents ?? [])
      recordContextObservation(config, event)
    try {
      await config.eventEmitter.emitTaskUpdated(snapshot)
    }
    catch (error) {
      finishTurnObservation(config, { status: 'failed', error })
      execution.finish()
      throw error
    }
    void runAgentLoop({
      execution,
      options,
      config,
      beforeToolExecute: this.beforeToolExecuteHook,
    }).catch(() => {})

    return { taskId }
  }

  approvePendingAction(options: ApprovePendingActionOptions): void {
    const task = this.taskStore.approve(options.taskId, options.actionId, options.selection, (pendingAction, workspacePath, selection) => {
      // Agent Runtime 是审批事务的唯一 owner：
      // 从 pending action 重建、规范化并验证最终规则，然后原子保存。
      // 持久化失败时保持等待审批状态，不执行工具。
      if (!pendingAction.approvalCandidates || !this.config.savePermissionRules) {
        throw new Error('当前工具调用不支持记忆授权')
      }
      const rules = rebuildRulesFromApproval(pendingAction.approvalCandidates, selection)
      if (rules.length === 0) {
        throw new Error('无法从审批选择重建规则')
      }
      // 一次原子写入全部保存；任何一条无效或写入失败都不执行任何段
      this.config.savePermissionRules(selection.scope, workspacePath, rules)
    })
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

  updateTaskMode(taskId: string, mode: AgentMode): AgentTaskSnapshot | null {
    const task = this.taskStore.updateMode(taskId, mode)
    if (!task)
      return null
    void this.config.eventEmitter.emitTaskUpdated(task.snapshot)
    return task.snapshot
  }

  async injectSteering(conversationId: string, text: string): Promise<IMessage> {
    return await this.sessionRuntime.injectSteering(conversationId, text)
  }

  getTask(taskId: string): AgentTaskSnapshot {
    const snapshot = this.taskStore.getSnapshot(taskId)
    if (!snapshot)
      throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')
    return snapshot
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

function beginTurnObservation(
  config: AgentRuntimeConfig,
  meta: Parameters<NonNullable<AgentRuntimeConfig['agentObservability']>['beginTurn']>[0],
) {
  try {
    return config.agentObservability?.beginTurn(meta)
  }
  catch (error) {
    config.logger?.warn('Agent Observability 启动失败', error)
    return undefined
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
