import type { AgentTaskSnapshot, AIProviderFactory, AppRpcInput, IAgentEventEmitter } from '@ant-chat/shared'
import type { ConversationLifecycle } from '../../../conversations/conversationLifecycle'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { createCommandController } from '../../../agent-runtime'
import { Method, Module } from '../../decorators'

@Module('commands')
export class CommandsModule implements RuntimeModuleMethods<'commands'> {
  private readonly controller: ReturnType<typeof createCommandController>

  constructor(
    core: Pick<RuntimeCore, 'data' | 'logger'>,
    dependencies: {
      listActiveTasks: (conversationId?: string) => AgentTaskSnapshot[]
      aiProviderFactory: AIProviderFactory
      eventEmitter: IAgentEventEmitter
      conversationLifecycle: ConversationLifecycle
    },
  ) {
    this.controller = createCommandController({
      appDataContext: core.data,
      eventEmitter: dependencies.eventEmitter,
      logger: core.logger,
      aiProviderFactory: dependencies.aiProviderFactory,
      listActiveTasks: dependencies.listActiveTasks,
      conversationLifecycle: dependencies.conversationLifecycle,
    })
  }

  @Method()
  runBuiltinCommand(input: AppRpcInput<'commands.runBuiltinCommand'>) {
    return this.controller.runBuiltinCommand(input)
  }

  @Method()
  async cancelCommand(input: AppRpcInput<'commands.cancelCommand'>) {
    await this.controller.cancelCommand(input.conversationId)
    return null
  }
}
