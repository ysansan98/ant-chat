import type { AgentTurnSummary, AIProviderFactory, AppRpcInput, IAgentEventEmitter } from '@ant-chat/shared'
import type { SkillManagementService } from '../../../agent-runtime'
import type { McpConnectionManager } from '../../../mcp'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import path from 'node:path'
import { createAgentRuntime } from '../../../agent-core'
import {
  createAgentTurnService,
  createAppDataSessionStore,
  createConversationTitleGenerator,
} from '../../../agent-runtime'
import { createAgentObservability } from '../../../agent-runtime/observability'
import { createConversationLifecycle } from '../../../conversations/conversationLifecycle'
import { RuntimeSecretRequestController } from '../../../secretRequestController'
import { Method, Module } from '../../decorators'

export interface AgentModuleDependencies {
  aiProviderFactory: AIProviderFactory
  mcpClientHub: McpConnectionManager
  skills: SkillManagementService
}

@Module('agent')
export class AgentModule implements RuntimeModuleMethods<'agent'> {
  readonly runtime: ReturnType<typeof createAgentRuntime>
  readonly turnService: ReturnType<typeof createAgentTurnService>
  readonly conversationLifecycle: ReturnType<typeof createConversationLifecycle>
  readonly eventEmitter: IAgentEventEmitter
  readonly titleGenerator: ReturnType<typeof createConversationTitleGenerator>
  readonly observability: ReturnType<typeof createAgentObservability>
  private readonly secretRequester: RuntimeSecretRequestController

  constructor(private readonly core: RuntimeCore, dependencies: AgentModuleDependencies) {
    this.eventEmitter = createAgentEventEmitter(core)
    this.secretRequester = new RuntimeSecretRequestController(core.secretStore, {
      emitSecretRequested(request) {
        core.events.emit('agent:secret-requested', { request })
      },
    })
    this.observability = createAgentObservability({
      rootDir: core.paths.observabilityRoot,
      legacyRoots: [path.join(core.paths.logsRoot, 'tasks')],
      logger: core.logger,
      onTurnSettled: event => core.events.emit('observability:turn-settled', event),
    })

    this.runtime = createAgentRuntime({
      host: {
        eventEmitter: this.eventEmitter,
        agentObservability: this.observability,
        sessionStore: createAppDataSessionStore(core.data),
        memoryReader: core.data.memoryManager,
        messageSearch: core.data.messageSearch,
        memoryCatalog: core.data.memoryCatalog,
        skillReader: dependencies.skills,
        mcpClientHub: dependencies.mcpClientHub,
        browser: core.browserPaths,
        browserAuthState: core.browserIdentity,
        commandHost: core.commandHost,
        loadFileData: core.data.loadAttachmentData,
        getPermissionRules: (workspacePath: string) => core.data.permissionsFileStore.getEffectiveRules(workspacePath),
        savePermissionRules: (scope, workspacePath, rules) => core.data.permissionsFileStore.saveRules(scope, workspacePath, rules),
        secretStore: core.secretStore,
        secretRequester: this.secretRequester,
      },
      overrides: {
        logger: core.logger,
      },
    })
    this.conversationLifecycle = createConversationLifecycle({
      data: core.data,
      events: core.events,
      runtime: this.runtime,
      observability: this.observability,
      logger: core.logger,
    })
    this.titleGenerator = createConversationTitleGenerator({
      providerSettingsRepository: core.data.providerSettingsRepository,
      messageRepository: core.data.messageRepository,
      updateConversation: input => this.conversationLifecycle.update(input),
      aiProviderFactory: dependencies.aiProviderFactory,
    })
    const turnService = createAgentTurnService({
      runtime: this.runtime,
      appDataContext: core.data,
      conversationLifecycle: this.conversationLifecycle,
      aiProviderFactory: dependencies.aiProviderFactory,
      titleGenerator: this.titleGenerator,
      emitMessageUpdated: message => core.events.emit('message:updated', { message }),
      logger: core.logger,
    })
    this.turnService = {
      startTurn: async (options) => {
        await this.refreshObservabilitySetting()
        return turnService.startTurn(options)
      },
    }
  }

  async initialize() {
    await this.observability.initialize()
    await this.refreshObservabilitySetting()
  }

  async dispose() {
    for (const task of this.runtime.listActiveTasks())
      this.runtime.cancelTask({ taskId: task.taskId })
    await this.runtime.dispose()
    await this.observability.dispose()
  }

  @Method()
  startTurn(input: AppRpcInput<'agent.startTurn'>) {
    return this.turnService.startTurn(input.options)
  }

  @Method()
  approvePendingAction(input: AppRpcInput<'agent.approvePendingAction'>) {
    this.runtime.approvePendingAction(input.options)
    return null
  }

  @Method()
  rejectPendingAction(input: AppRpcInput<'agent.rejectPendingAction'>) {
    this.runtime.rejectPendingAction(input.options)
    return null
  }

  @Method()
  resolveSecretRequest(input: AppRpcInput<'agent.resolveSecretRequest'>) {
    this.secretRequester.resolveSecretRequest(input.options)
    return null
  }

  @Method()
  rejectSecretRequest(input: AppRpcInput<'agent.rejectSecretRequest'>) {
    this.secretRequester.rejectSecretRequest(input.options)
    return null
  }

  @Method()
  cancelTask(input: AppRpcInput<'agent.cancelTask'>) {
    this.runtime.cancelTask({ taskId: input.taskId })
    return null
  }

  @Method()
  updateTaskMode(input: AppRpcInput<'agent.updateTaskMode'>) {
    return this.runtime.updateTaskMode(input.taskId, input.mode)
  }

  @Method()
  injectSteering(input: AppRpcInput<'agent.injectSteering'>) {
    return this.runtime.injectSteering(input.conversationId, input.text)
  }

  @Method()
  listActiveTasks(input: AppRpcInput<'agent.listActiveTasks'>) {
    return this.runtime.listActiveTasks(input?.conversationId)
  }

  @Method()
  async listTurns(input: AppRpcInput<'agent.listTurns'>) {
    const summaries = await this.observability.listTurns(input.conversationId)
    const summariesByTurn = new Map(summaries.map(summary => [summary.turnId, summary]))
    const messages = await this.core.data.messageRepository.listByConversation(input.conversationId)
    const turnCreatedAt = new Map(messages.map(message => [message.id, message.createdAt]))
    const result: AgentTurnSummary[] = messages
      .filter(message => message.role === 'user' && !message.turnId)
      .map(message => summariesByTurn.get(message.id) ?? {
        availability: 'not-collected' as const,
        conversationId: input.conversationId,
        turnId: message.id,
        message: '该 Turn 未启用 Agent Observability',
      })
    const knownTurnIds = new Set(result.map(summary => summary.turnId))
    result.push(...summaries.filter(summary => !knownTurnIds.has(summary.turnId)))
    return result.sort((left, right) => {
      const leftStartedAt = left.availability === 'available' ? left.startedAt : turnCreatedAt.get(left.turnId) ?? 0
      const rightStartedAt = right.availability === 'available' ? right.startedAt : turnCreatedAt.get(right.turnId) ?? 0
      return rightStartedAt - leftStartedAt
    })
  }

  @Method()
  getTurnTimeline(input: AppRpcInput<'agent.getTurnTimeline'>) {
    return this.observability.getTurnTimeline(input)
  }

  @Method()
  getEvidence(input: AppRpcInput<'agent.getEvidence'>) {
    return this.observability.getEvidence(input)
  }

  @Method()
  async clearAllObservability(_input?: AppRpcInput<'agent.clearAllObservability'>) {
    await this.observability.clearAll()
    return null
  }

  private async refreshObservabilitySetting() {
    try {
      const settings = await this.core.data.settingsRepository.getGeneralSettings()
      this.observability.setEnabled(settings.developerTools.agentObservabilityEnabled)
    }
    catch (error) {
      this.observability.setEnabled(false)
      this.core.logger.warn('读取 Agent Observability 设置失败，当前 Turn 不采集', error)
    }
  }
}

function createAgentEventEmitter(core: Pick<RuntimeCore, 'events'>): IAgentEventEmitter {
  return {
    emitMessageUpdated(message) {
      core.events.emit('message:updated', { message })
    },
    emitTaskUpdated(task) {
      core.events.emit('agent:task-updated', { task })
    },
    emitApprovalRequired(taskId, conversationId, pendingAction) {
      core.events.emit('agent:approval-required', { taskId, conversationId, pendingAction })
    },
    emitTurnStarted() {},
    emitTurnChunk() {},
    emitTurnToolCalls() {},
    emitTurnToolResults() {},
    emitTurnFinished(params) {
      core.events.emit('agent:turn-finished', {
        conversationId: params.conversationId,
        turnId: params.turnId,
        status: params.status,
      })
    },
  }
}
