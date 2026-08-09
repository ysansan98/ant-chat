import type { AppRpcInput } from '@ant-chat/shared'
import type { AgentTurnService } from '../../../agent-runtime'
import type { AutomationRepository } from '../../../data'
import type { RuntimeEventBus } from '../../../events'
import type { SystemLogger } from '../../../systemLogger'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { createAutomationRuntime } from '../../../automations'
import { Method, Module } from '../../decorators'

@Module('automation')
export class AutomationModule implements RuntimeModuleMethods<'automation'> {
  private readonly runtime: ReturnType<typeof createAutomationRuntime>

  constructor(
    automationRepository: AutomationRepository,
    events: RuntimeEventBus,
    logger: SystemLogger,
    dependencies: {
      startTurn: AgentTurnService['startTurn']
      cancelTask: (taskId: string) => void
    },
  ) {
    this.runtime = createAutomationRuntime({
      repository: automationRepository,
      startTurn: dependencies.startTurn,
      cancelTask: dependencies.cancelTask,
      events,
      logger,
    })
  }

  initialize() {
    return this.runtime.initialize()
  }

  dispose() {
    return this.runtime.dispose()
  }

  @Method()
  list(_input?: AppRpcInput<'automation.list'>) {
    return this.runtime.list()
  }

  async get(id: string) {
    return this.runtime.get(id)
  }

  @Method()
  create(input: AppRpcInput<'automation.create'>) {
    return this.runtime.create(input.input)
  }

  @Method()
  update(input: AppRpcInput<'automation.update'>) {
    return this.runtime.update(input.input)
  }

  @Method()
  async delete(input: AppRpcInput<'automation.delete'>) {
    await this.runtime.delete(input.id)
    return null
  }

  async safeDelete(id: string, force?: boolean): Promise<void> {
    await this.runtime.delete(id, { force })
  }

  @Method()
  setEnabled(input: AppRpcInput<'automation.setEnabled'>) {
    return this.runtime.setEnabled(input.id, input.enabled)
  }

  @Method()
  runNow(input: AppRpcInput<'automation.runNow'>) {
    return this.runtime.runNow(input.id)
  }

  @Method()
  listRuns(input: AppRpcInput<'automation.listRuns'>) {
    return this.runtime.listRuns(input.automationId, input.limit)
  }

  @Method()
  markRunRead(input: AppRpcInput<'automation.markRunRead'>) {
    return this.runtime.markRunRead(input.id)
  }
}
