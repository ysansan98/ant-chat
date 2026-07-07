import type { AutomationDefinition, AutomationInput, AutomationRun, ILogger, StartAgentTurnOptions, UpdateAutomationInput } from '@ant-chat/shared'
import type { AutomationRepository } from '../data'
import type { RuntimeEventBus } from '../events'
import type { AutomationScheduler } from './automationScheduler'
import { validateSchedule } from './schedule'

export function createAutomationService(options: {
  repository: AutomationRepository
  startTurn: (input: StartAgentTurnOptions) => Promise<{ taskId: string, conversationId: string }>
  cancelTask: (taskId: string) => void
  events: RuntimeEventBus
  logger?: ILogger
}) {
  const runByTaskId = new Map<string, string>()
  let scheduler: AutomationScheduler | undefined

  options.events.on('agent:task-updated', ({ task }) => {
    const runId = runByTaskId.get(task.taskId)
    if (!runId)
      return
    if (task.status === 'awaiting_approval') {
      options.cancelTask(task.taskId)
      void finishRun(runId, 'needs_attention', task.errorCode, '任务需要额外授权')
    }
    else if (task.status === 'success' || task.status === 'failed' || task.status === 'cancelled') {
      const status = task.status === 'success' ? 'succeeded' : task.status
      void finishRun(runId, status, task.errorCode, task.errorMessage)
    }
  })
  options.events.on('agent:secret-requested', ({ request }) => {
    const runId = runByTaskId.get(request.runId)
    if (!runId)
      return
    options.cancelTask(request.runId)
    void finishRun(runId, 'needs_attention', 'AUTOMATION_SECRET_REQUIRED', '任务需要补充秘密信息')
  })

  async function finishRun(runId: string, status: AutomationRun['status'], errorCode?: string, errorMessage?: string) {
    const run = await options.repository.updateRun(runId, { status, errorCode, errorMessage, finishedAt: Date.now() })
    if (run.taskId)
      runByTaskId.delete(run.taskId)
    options.events.emit('automation:run-changed', { run })
    return run
  }

  async function execute(automation: AutomationDefinition, runId: string) {
    let run = await options.repository.updateRun(runId, { status: 'running', startedAt: Date.now() })
    options.events.emit('automation:run-changed', { run })
    try {
      const result = await options.startTurn({
        prompt: automation.prompt,
        workspacePath: automation.workspacePath,
        turnSource: {
          type: 'automation',
          automationId: automation.id,
          runId,
          allowedSkills: automation.allowedSkills,
          allowedMcpServers: automation.allowedMcpServers,
          permissionPolicy: automation.permissionPolicy,
        },
        mode: 'strict',
        modelConfig: {
          providerId: automation.providerId,
          modelId: automation.modelId,
          features: { enableMCP: automation.allowedMcpServers.length > 0 },
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 4096,
        },
      })
      run = await options.repository.updateRun(runId, { taskId: result.taskId, conversationId: result.conversationId })
      runByTaskId.set(result.taskId, runId)
      options.events.emit('automation:run-changed', { run })
      return run
    }
    catch (error) {
      return await finishRun(runId, 'failed', 'AUTOMATION_START_FAILED', error instanceof Error ? error.message : String(error))
    }
  }

  const service = {
    setScheduler(value: AutomationScheduler) {
      scheduler = value
    },
    list: () => options.repository.list(),
    listRuns: (automationId?: string, limit?: number) => options.repository.listRuns(automationId, limit),
    async create(input: AutomationInput) {
      const automation = await options.repository.create(input, input.enabled ? validateSchedule(input.schedule) : undefined)
      options.events.emit('automation:changed', { automation })
      await scheduler?.reschedule()
      return automation
    },
    async update(input: UpdateAutomationInput) {
      const current = await options.repository.getById(input.id)
      const next = { ...current, ...input }
      const automation = await options.repository.update(input, next.enabled ? validateSchedule(next.schedule) : undefined)
      options.events.emit('automation:changed', { automation })
      await scheduler?.reschedule()
      return automation
    },
    async setEnabled(id: string, enabled: boolean) {
      return service.update({ id, enabled })
    },
    async delete(id: string) {
      await options.repository.delete(id)
      await scheduler?.reschedule()
    },
    async cancelActiveRuns(automationId: string) {
      const runs = await options.repository.listRuns(automationId)
      const activeRuns = runs.filter(run => run.status === 'queued' || run.status === 'running')
      for (const run of activeRuns) {
        if (run.taskId) {
          runByTaskId.delete(run.taskId)
          options.cancelTask(run.taskId)
        }
        const cancelled = await options.repository.updateRun(run.id, { status: 'cancelled', finishedAt: Date.now() })
        options.events.emit('automation:run-changed', { run: cancelled })
      }
      return activeRuns.length
    },
    async runNow(id: string) {
      const automation = await options.repository.getById(id)
      const run = await options.repository.createManualRun(id, Date.now())
      return await execute(automation, run.id)
    },
    execute,
  }
  return service
}
