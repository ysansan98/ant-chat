import type { AutomationDefinition, ILogger } from '@ant-chat/shared'
import type { AutomationRepository } from '../data'
import { getNextRunAt } from './schedule'

const MAX_TIMEOUT_MS = 2_147_000_000

export interface AutomationScheduler {
  start: () => Promise<void>
  reschedule: () => Promise<void>
  dispose: () => void
}

export function createAutomationScheduler(options: {
  repository: AutomationRepository
  execute: (automation: AutomationDefinition, runId: string) => Promise<void>
  logger?: ILogger
  now?: () => number
}): AutomationScheduler {
  const now = options.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let processing = false

  async function processDue() {
    if (processing || disposed)
      return
    processing = true
    try {
      const current = now()
      const due = await options.repository.listDue(current)
      for (const automation of due) {
        const scheduledAt = automation.nextRunAt
        if (scheduledAt === undefined)
          continue
        const nextRunAt = automation.schedule.type === 'cron'
          ? getNextRunAt(automation.schedule, Math.max(current, scheduledAt))
          : undefined
        const run = await options.repository.claim(automation, scheduledAt, nextRunAt)
        if (run)
          void options.execute(automation, run.id).catch(error => options.logger?.error('自动化执行失败', error))
      }
    }
    finally {
      processing = false
      await reschedule()
    }
  }

  async function reschedule() {
    if (timer)
      clearTimeout(timer)
    if (disposed)
      return
    const next = await options.repository.getEarliestNextRunAt()
    if (next === undefined)
      return
    const delay = Math.min(Math.max(0, next - now()), MAX_TIMEOUT_MS)
    timer = setTimeout(() => void processDue(), delay)
  }

  return {
    async start() {
      disposed = false
      await processDue()
    },
    reschedule,
    dispose() {
      disposed = true
      if (timer)
        clearTimeout(timer)
      timer = undefined
    },
  }
}
