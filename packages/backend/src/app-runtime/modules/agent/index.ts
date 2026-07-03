import type { AIProviderFactory, AppRpcInput, IAgentEventEmitter } from '@ant-chat/shared'
import type { SkillManagementService } from '../../../agent-runtime'
import type { MCPClientHub } from '../../../mcp'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { createAgentRuntime } from '../../../agent-core'
import {
  createAgentRuntimeController,
  createAppDataSessionStore,
  createConversationTitleGenerator,
  createTaskLoggerFactory,
} from '../../../agent-runtime'
import { RuntimeSecretRequestController } from '../../../secretRequestController'
import { Method, Module } from '../../decorators'

export interface AgentModuleDependencies {
  aiProviderFactory: AIProviderFactory
  mcpClientHub: MCPClientHub
  skills: SkillManagementService
}

@Module('agent')
export class AgentModule implements RuntimeModuleMethods<'agent'> {
  readonly runtime: ReturnType<typeof createAgentRuntime>
  readonly controller: ReturnType<typeof createAgentRuntimeController>
  readonly eventEmitter: IAgentEventEmitter
  readonly titleGenerator: ReturnType<typeof createConversationTitleGenerator>
  private readonly secretRequester: RuntimeSecretRequestController

  constructor(core: RuntimeCore, dependencies: AgentModuleDependencies) {
    this.eventEmitter = createAgentEventEmitter(core)
    this.secretRequester = new RuntimeSecretRequestController(core.secretStore, {
      emitSecretRequested(request) {
        core.events.emit('agent:secret-requested', { request })
      },
    })
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
      overrides: { logger: core.logger, aiProviderFactory: dependencies.aiProviderFactory },
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

  async dispose() {
    for (const task of this.runtime.listActiveTasks())
      this.runtime.cancelTask({ taskId: task.taskId })
    await this.runtime.dispose()
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
