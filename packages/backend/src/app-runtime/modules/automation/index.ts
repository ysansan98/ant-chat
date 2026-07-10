import type { AppRpcInput } from '@ant-chat/shared'
import type { AgentTurnService } from '../../../agent-runtime'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { createAutomationScheduler, createAutomationService } from '../../../automations'
import { Method, Module } from '../../decorators'

@Module('automation')
export class AutomationModule implements RuntimeModuleMethods<'automation'> {
  private readonly scheduler: ReturnType<typeof createAutomationScheduler>
  private readonly service: ReturnType<typeof createAutomationService>

  constructor(
    private readonly core: Pick<RuntimeCore, 'data' | 'events' | 'logger'>,
    dependencies: {
      startTurn: AgentTurnService['startTurn']
      cancelTask: (taskId: string) => void
    },
  ) {
    this.service = createAutomationService({
      repository: core.data.automationRepository,
      startTurn: dependencies.startTurn,
      cancelTask: dependencies.cancelTask,
      events: core.events,
      logger: core.logger,
    })
    this.scheduler = createAutomationScheduler({
      repository: core.data.automationRepository,
      execute: async (automation, runId) => {
        await this.service.execute(automation, runId)
      },
      logger: core.logger,
    })
    this.service.setScheduler(this.scheduler)
  }

  initialize() {
    return this.scheduler.start()
  }

  async dispose() {
    this.scheduler.dispose()
    await this.core.data.automationRepository.cancelRunning(Date.now())
  }

  @Method()
  list(_input?: AppRpcInput<'automation.list'>) {
    return this.service.list()
  }

  @Method()
  create(input: AppRpcInput<'automation.create'>) {
    return this.service.create(input.input)
  }

  @Method()
  update(input: AppRpcInput<'automation.update'>) {
    return this.service.update(input.input)
  }

  @Method()
  async delete(input: AppRpcInput<'automation.delete'>) {
    await this.service.delete(input.id)
    return null
  }

  /** 安全删除 — 检查活跃 run 并支持 force */
  async safeDelete(id: string, force?: boolean): Promise<void> {
    const runs = await this.service.listRuns(id)
    const hasActiveRun = runs.some(r => r.status === 'queued' || r.status === 'running')
    if (hasActiveRun && !force) {
      throw new Error(`Automation ${id} has active runs. Use --force to cancel and delete.`)
    }
    if (hasActiveRun && force) {
      await this.service.cancelActiveRuns(id)
    }
    await this.service.delete(id)
  }

  @Method()
  setEnabled(input: AppRpcInput<'automation.setEnabled'>) {
    return this.service.setEnabled(input.id, input.enabled)
  }

  @Method()
  runNow(input: AppRpcInput<'automation.runNow'>) {
    return this.service.runNow(input.id)
  }

  @Method()
  listRuns(input: AppRpcInput<'automation.listRuns'>) {
    return this.service.listRuns(input.automationId, input.limit)
  }
}
