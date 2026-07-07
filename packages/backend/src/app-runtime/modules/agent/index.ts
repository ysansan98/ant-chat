import type { AIProviderFactory, AppRpcInput, IAgentEventEmitter } from '@ant-chat/shared'
import type { SkillManagementService } from '../../../agent-runtime'
import type { MCPClientHub } from '../../../mcp'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import path from 'node:path'
import { createAgentRuntime } from '../../../agent-core'
import {
  ContextTraceWriter,
  ConversationTaskLoggerManager,
  createAgentRuntimeController,
  createAppDataSessionStore,
  createContextTraceReader,
  createConversationTitleGenerator,
  createTaskLoggerFactory,
} from '../../../agent-runtime'
import { RuntimeSecretRequestController } from '../../../secretRequestController'
import { Method, Module } from '../../decorators'

export interface AgentModuleDependencies {
  aiProviderFactory: AIProviderFactory
  mcpClientHub: MCPClientHub
  skills: SkillManagementService
  contextDiagnosticsEnabled?: boolean
}

@Module('agent')
export class AgentModule implements RuntimeModuleMethods<'agent'> {
  readonly runtime: ReturnType<typeof createAgentRuntime>
  readonly controller: ReturnType<typeof createAgentRuntimeController>
  readonly eventEmitter: IAgentEventEmitter
  readonly titleGenerator: ReturnType<typeof createConversationTitleGenerator>
  private readonly secretRequester: RuntimeSecretRequestController
  private readonly contextTraceReader: ReturnType<typeof createContextTraceReader>
  private readonly contextTraceLogsRoot: string
  private readonly conversationLoggerManager: ConversationTaskLoggerManager | null
  private contextDiagnosticsEnabled: boolean

  constructor(core: RuntimeCore, dependencies: AgentModuleDependencies) {
    this.eventEmitter = createAgentEventEmitter(core)
    this.secretRequester = new RuntimeSecretRequestController(core.secretStore, {
      emitSecretRequested(request) {
        core.events.emit('agent:secret-requested', { request })
      },
    })
    this.contextTraceLogsRoot = core.paths.taskLogsRoot
    this.contextTraceReader = createContextTraceReader({ taskLogsRoot: core.paths.taskLogsRoot })
    this.contextDiagnosticsEnabled = dependencies.contextDiagnosticsEnabled ?? false
    if (this.contextDiagnosticsEnabled) {
      this.conversationLoggerManager = new ConversationTaskLoggerManager(core.paths.taskLogsRoot)
    }
    else {
      this.conversationLoggerManager = null
    }

    // 创建 ContextTraceWriter（诊断启用时注入全局 config）
    let contextTraceWriter: ContextTraceWriter | undefined
    if (this.contextDiagnosticsEnabled && this.conversationLoggerManager) {
      contextTraceWriter = new ContextTraceWriter({
        enabled: true,
        loggerManager: this.conversationLoggerManager,
      })
    }

    this.runtime = createAgentRuntime({
      host: {
        eventEmitter: this.eventEmitter,
        sessionStore: createAppDataSessionStore(core.data),
        modelCatalog: core.data.modelCatalog,
        memoryReader: core.data.memoryManager,
        skillReader: dependencies.skills,
        mcpClientHub: dependencies.mcpClientHub,
        browser: core.browserPaths,
        loadFileData: core.data.loadAttachmentData,
        createTaskLogger: createTaskLoggerFactory(core.paths.taskLogsRoot),
        getToolApprovalWhitelistEntries: () => core.data.toolApprovalWhitelistRepository.getAll(),
        secretStore: core.secretStore,
        secretRequester: this.secretRequester,
      },
      overrides: {
        logger: core.logger,
        aiProviderFactory: dependencies.aiProviderFactory,
        contextTraceCapture: contextTraceWriter
          ? (payload) => { contextTraceWriter.capture(payload as never) }
          : undefined,
        contextTraceCaptureResponse: contextTraceWriter
          ? (payload) => { contextTraceWriter.captureResponse(payload.conversationId, payload.requestId, payload.text) }
          : undefined,
      },
    })
    this.titleGenerator = createConversationTitleGenerator({
      providerSettingsRepository: core.data.providerSettingsRepository,
      messageRepository: core.data.messageRepository,
      conversationRepository: core.data.conversationRepository,
      aiProviderFactory: dependencies.aiProviderFactory,
    })
    this.controller = createAgentRuntimeController(this.runtime, core.data, {
      aiProviderFactory: dependencies.aiProviderFactory,
      titleGenerator: this.titleGenerator,
      emitConversationUpdated: conversation => core.events.emit('conversation:updated', { conversation }),
      emitMessageUpdated: message => core.events.emit('message:updated', { message }),
      logger: core.logger,
    })
  }

  setAppControl(appControl: NonNullable<import('@ant-chat/shared').AgentRuntimeConfig['appControl']>) {
    this.runtime.setAppControl(appControl)
  }

  async dispose() {
    for (const task of this.runtime.listActiveTasks())
      this.runtime.cancelTask({ taskId: task.taskId })
    await this.runtime.dispose()
    this.conversationLoggerManager?.closeAll()
  }

  @Method()
  startTurn(input: AppRpcInput<'agent.startTurn'>) {
    return this.controller.startTurn(input.options)
  }

  @Method()
  approvePendingAction(input: AppRpcInput<'agent.approvePendingAction'>) {
    return this.controller.approvePendingAction(input.options)
  }

  @Method()
  rejectPendingAction(input: AppRpcInput<'agent.rejectPendingAction'>) {
    return this.controller.rejectPendingAction(input.options)
  }

  @Method()
  approvePendingActionWithWhitelist(input: AppRpcInput<'agent.approvePendingActionWithWhitelist'>) {
    return this.controller.approvePendingActionWithWhitelist(input.options)
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
    return this.controller.cancelTask({ taskId: input.taskId })
  }

  @Method()
  injectSteering(input: AppRpcInput<'agent.injectSteering'>) {
    return this.controller.injectSteering(input)
  }

  @Method()
  listActiveTasks(input: AppRpcInput<'agent.listActiveTasks'>) {
    return this.controller.listActiveTasks(input?.conversationId)
  }

  @Method()
  listContextTrace(input: AppRpcInput<'agent.listContextTrace'>) {
    if (!this.contextDiagnosticsEnabled) {
      throw new Error('Context diagnostics is not enabled')
    }
    return this.contextTraceReader.listTraceItems(input.conversationId, input.before, input.limit)
  }

  @Method()
  getContextTraceItem(input: AppRpcInput<'agent.getContextTraceItem'>) {
    if (!this.contextDiagnosticsEnabled) {
      throw new Error('Context diagnostics is not enabled')
    }
    return this.contextTraceReader.getTraceItem(input.conversationId, input.requestId, input.itemId)
  }

  @Method()
  getContextTraceLogPath(input: AppRpcInput<'agent.getContextTraceLogPath'>) {
    if (!this.contextDiagnosticsEnabled) {
      throw new Error('Context diagnostics is not enabled')
    }
    return path.join(this.contextTraceLogsRoot, `${input.conversationId}.jsonl`)
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
