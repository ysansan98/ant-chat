import type {
  AutomationDefinition,
  AutomationInput,
  AutomationRun,
  ILogger,
  StartAgentTurnOptions,
  UpdateAutomationInput,
} from '@ant-chat/shared'
import type { AutomationRepository } from '../data'
import type { RuntimeEventBus } from '../events'
import { getNextRunAt, validateSchedule } from './schedule'

const MAX_TIMEOUT_MS = 2_147_000_000
const MAX_REMEMBERED_TERMINAL_RUNS = 1_000

export interface AutomationRuntime {
  initialize: () => Promise<void>
  dispose: () => Promise<void>
  list: () => Promise<AutomationDefinition[]>
  get: (id: string) => Promise<AutomationDefinition>
  listRuns: (automationId?: string, limit?: number) => Promise<AutomationRun[]>
  create: (input: AutomationInput) => Promise<AutomationDefinition>
  update: (input: UpdateAutomationInput) => Promise<AutomationDefinition>
  setEnabled: (id: string, enabled: boolean) => Promise<AutomationDefinition>
  delete: (id: string, options?: { force?: boolean }) => Promise<void>
  runNow: (id: string) => Promise<AutomationRun>
  markRunRead: (id: string) => Promise<AutomationRun>
}

export interface AutomationClock {
  now: () => number
  setTimeout?: (callback: () => void, delay: number) => unknown
  clearTimeout?: (timer: unknown) => void
}

export function createAutomationRuntime(options: {
  repository: AutomationRepository
  startTurn: (input: StartAgentTurnOptions) => Promise<{ taskId: string, conversationId: string, userMessageId: string }>
  cancelTask: (taskId: string) => void
  events: Pick<RuntimeEventBus, 'on' | 'emit'>
  logger?: ILogger
  clock?: AutomationClock
}): AutomationRuntime {
  const clock = options.clock ?? { now: Date.now }
  const runByTaskId = new Map<string, string>()
  const pendingExecutions = new Map<Promise<AutomationRun>, string>()
  const pendingFinishes = new Set<Promise<AutomationRun>>()
  const finishByRunId = new Map<string, Promise<AutomationRun>>()
  const terminalRunIds = new Set<string>()
  const cancelledRuns = new Map<string, AutomationRun>()
  let timer: unknown
  let disposed = false
  let processing = false

  function markTerminalRun(runId: string): void {
    terminalRunIds.add(runId)
    if (terminalRunIds.size <= MAX_REMEMBERED_TERMINAL_RUNS)
      return
    const oldestRunId = terminalRunIds.values().next().value
    if (oldestRunId)
      terminalRunIds.delete(oldestRunId)
  }

  function trackFinish(runId: string, finish: Promise<AutomationRun>) {
    pendingFinishes.add(finish)
    finishByRunId.set(runId, finish)
    void finish.then(
      () => {
        pendingFinishes.delete(finish)
        if (finishByRunId.get(runId) === finish)
          finishByRunId.delete(runId)
      },
      (error) => {
        pendingFinishes.delete(finish)
        if (finishByRunId.get(runId) === finish)
          finishByRunId.delete(runId)
        // 持久化终态失败时允许后续同一终态事件重试，避免 run 永久卡在 running。
        terminalRunIds.delete(runId)
        options.logger?.error('自动化运行收尾失败', error)
      },
    )
  }

  const unsubscribeTaskUpdated = options.events.on('agent:task-updated', ({ task }) => {
    const sourceRunId = task.turnSource?.type === 'automation' ? task.turnSource.runId : undefined
    const runId = runByTaskId.get(task.taskId) ?? sourceRunId
    if (!runId) {
      return
    }
    if (terminalRunIds.has(runId))
      return
    if (task.status === 'running') {
      runByTaskId.set(task.taskId, runId)
      return
    }
    if (task.status === 'awaiting_approval') {
      markTerminalRun(runId)
      runByTaskId.delete(task.taskId)
      options.cancelTask(task.taskId)
      // 无人值守跑不下去，需要用户操作；awaiting 是执行态（卡住等你），不是成败判定
      trackFinish(runId, finishRun(runId, 'awaiting', task.errorCode, '任务需要额外授权'))
    }
    else if (task.status === 'success' || task.status === 'failed') {
      markTerminalRun(runId)
      runByTaskId.delete(task.taskId)
      // 无人值守下成败无法可靠判定，统一收口为 completed；异常/拒绝信息保留在
      // errorCode/errorMessage/summary，打开 run 会话查看产出后由用户自己判断
      trackFinish(runId, finishRun(runId, 'completed', task.errorCode, task.errorMessage, task.summary))
    }
    else if (task.status === 'cancelled') {
      markTerminalRun(runId)
      runByTaskId.delete(task.taskId)
      trackFinish(runId, finishRun(runId, 'cancelled', task.errorCode, task.errorMessage, task.summary))
    }
  })
  const unsubscribeSecretRequested = options.events.on('agent:secret-requested', ({ request }) => {
    // SecretRequest.runId 是 taskId；automationRunId 让 startTurn 返回前的早到事件
    // 也能定位运行，避免依赖尚未建立的 taskId 映射。
    const taskId = request.runId
    const runId = runByTaskId.get(taskId) ?? request.automationRunId
    if (!runId) {
      return
    }
    if (terminalRunIds.has(runId))
      return
    runByTaskId.delete(taskId)
    options.cancelTask(taskId)
    markTerminalRun(runId)
    trackFinish(runId, finishRun(runId, 'awaiting', 'AUTOMATION_SECRET_REQUIRED', '任务需要补充秘密信息'))
  })

  function clearTimer() {
    if (timer === undefined) {
      return
    }
    if (clock.clearTimeout) {
      clock.clearTimeout(timer)
    }
    else {
      clearTimeout(timer as ReturnType<typeof setTimeout>)
    }
    timer = undefined
  }

  function scheduleTimer(callback: () => void, delay: number) {
    return clock.setTimeout ? clock.setTimeout(callback, delay) : setTimeout(callback, delay)
  }

  async function finishRun(runId: string, status: AutomationRun['status'], errorCode?: string, errorMessage?: string, summary?: string) {
    const run = await options.repository.updateRun(runId, {
      status,
      errorCode,
      errorMessage,
      summary,
      finishedAt: clock.now(),
    })
    if (run.taskId) {
      runByTaskId.delete(run.taskId)
    }
    options.events.emit('automation:run-changed', { run })
    return run
  }

  async function execute(automation: AutomationDefinition, runId: string) {
    let run = await options.repository.updateRun(runId, { status: 'running', startedAt: clock.now() })
    if (cancelledRuns.has(runId))
      return await ensureCancelled(runId)
    options.events.emit('automation:run-changed', { run })
    try {
      const result = await options.startTurn({
        messageContent: [{ type: 'text', text: automation.prompt }],
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
        },
      })
      if (cancelledRuns.has(runId) || disposed) {
        options.cancelTask(result.taskId)
        return disposed
          ? await finishRun(runId, 'cancelled')
          : await ensureCancelled(runId)
      }
      const earlyFinish = finishByRunId.get(runId)
      if (earlyFinish)
        await earlyFinish
      if (terminalRunIds.has(runId)) {
        run = await options.repository.updateRun(runId, {
          taskId: result.taskId,
          conversationId: result.conversationId,
          turnId: result.userMessageId,
        })
        options.events.emit('automation:run-changed', { run })
        return run
      }
      // 先建立内存映射，再持久化 taskId，避免终态事件恰好落在两者之间而丢失。
      runByTaskId.set(result.taskId, runId)
      run = await options.repository.updateRun(runId, {
        taskId: result.taskId,
        conversationId: result.conversationId,
        turnId: result.userMessageId,
      })
      options.events.emit('automation:run-changed', { run })
      return run
    }
    catch (error) {
      if (cancelledRuns.has(runId))
        return await ensureCancelled(runId)
      return await finishRun(runId, 'completed', 'AUTOMATION_START_FAILED', error instanceof Error ? error.message : String(error))
    }
  }

  function trackExecution(automation: AutomationDefinition, runId: string) {
    const execution = execute(automation, runId)
    pendingExecutions.set(execution, automation.id)
    void execution.then(
      () => pendingExecutions.delete(execution),
      () => pendingExecutions.delete(execution),
    )
    return execution
  }

  async function reschedule() {
    clearTimer()
    if (disposed) {
      return
    }
    const nextRunAt = await options.repository.getEarliestNextRunAt()
    if (nextRunAt === undefined) {
      return
    }
    const delay = Math.min(Math.max(0, nextRunAt - clock.now()), MAX_TIMEOUT_MS)
    timer = scheduleTimer(() => void processDue(), delay)
  }

  async function processDue() {
    if (processing || disposed) {
      return
    }
    processing = true
    try {
      const current = clock.now()
      const due = await options.repository.listDue(current)
      for (const automation of due) {
        const scheduledAt = automation.nextRunAt
        if (scheduledAt === undefined) {
          continue
        }
        const nextRunAt = automation.schedule.type === 'cron'
          ? getNextRunAt(automation.schedule, Math.max(current, scheduledAt))
          : undefined
        const run = await options.repository.claim(automation, scheduledAt, nextRunAt)
        if (run) {
          void trackExecution(automation, run.id)
            .catch(error => options.logger?.error('自动化执行失败', error))
        }
      }
    }
    finally {
      processing = false
      await reschedule()
    }
  }

  async function ensureCancelled(runId: string): Promise<AutomationRun> {
    const cancelled = await options.repository.updateRun(runId, {
      status: 'cancelled',
      finishedAt: clock.now(),
    })
    cancelledRuns.set(runId, cancelled)
    options.events.emit('automation:run-changed', { run: cancelled })
    return cancelled
  }

  async function cancelActiveRuns(automationId: string): Promise<void> {
    const runs = await options.repository.listRuns(automationId)
    const activeRuns = runs.filter(run => run.status === 'queued' || run.status === 'running')
    const activeRunIds = new Set(activeRuns.map(run => run.id))
    for (const run of activeRuns)
      cancelledRuns.set(run.id, { ...run, status: 'cancelled', finishedAt: clock.now() })

    for (const run of activeRuns) {
      if (run.taskId) {
        runByTaskId.delete(run.taskId)
        options.cancelTask(run.taskId)
      }
      await ensureCancelled(run.id)
    }

    // startTurn 或 taskId 持久化可能仍在途；必须等待后重新发现并取消晚到任务。
    const pending = [...pendingExecutions]
      .filter(([, id]) => id === automationId)
      .map(([execution]) => execution)
    await Promise.allSettled(pending)

    const refreshedRuns = await options.repository.listRuns(automationId)
    const lateTaskIds = new Set(
      refreshedRuns
        .filter(run => activeRunIds.has(run.id) && run.taskId)
        .map(run => run.taskId!),
    )
    for (const [taskId, runId] of runByTaskId) {
      if (activeRunIds.has(runId))
        lateTaskIds.add(taskId)
    }
    for (const taskId of lateTaskIds) {
      runByTaskId.delete(taskId)
      options.cancelTask(taskId)
    }
    for (const run of activeRuns)
      await ensureCancelled(run.id)
  }

  const runtime: AutomationRuntime = {
    async initialize() {
      disposed = false
      await processDue()
    },
    async dispose() {
      disposed = true
      clearTimer()
      unsubscribeTaskUpdated()
      unsubscribeSecretRequested()
      await Promise.allSettled(pendingExecutions.keys())
      await Promise.allSettled(pendingFinishes)
      for (const taskId of runByTaskId.keys()) {
        options.cancelTask(taskId)
      }
      runByTaskId.clear()
      finishByRunId.clear()
      terminalRunIds.clear()
      await options.repository.cancelRunning(clock.now())
    },
    list: () => options.repository.list(),
    get: id => options.repository.getById(id),
    listRuns: (automationId, limit) => options.repository.listRuns(automationId, limit),
    async create(input) {
      const automation = await options.repository.create(input, input.enabled ? validateSchedule(input.schedule) : undefined)
      options.events.emit('automation:changed', { automation })
      await reschedule()
      return automation
    },
    async update(input) {
      const current = await options.repository.getById(input.id)
      const next = { ...current, ...input }
      const automation = await options.repository.update(input, next.enabled ? validateSchedule(next.schedule) : undefined)
      options.events.emit('automation:changed', { automation })
      await reschedule()
      return automation
    },
    setEnabled(id, enabled) {
      return runtime.update({ id, enabled })
    },
    async delete(id, deleteOptions) {
      const runs = await options.repository.listRuns(id)
      const hasActiveRun = runs.some(run => run.status === 'queued' || run.status === 'running')
      if (hasActiveRun && !deleteOptions?.force) {
        throw new Error(`自动化 ${id} 存在活跃运行，请使用 force 取消后删除`)
      }
      if (hasActiveRun) {
        await cancelActiveRuns(id)
      }
      await options.repository.delete(id)
      for (const run of runs)
        cancelledRuns.delete(run.id)
      await reschedule()
    },
    async runNow(id) {
      const automation = await options.repository.getById(id)
      const run = await options.repository.createManualRun(id, clock.now())
      return await trackExecution(automation, run.id)
    },
    markRunRead: id => options.repository.markRunRead(id, clock.now()),
  }
  return runtime
}
