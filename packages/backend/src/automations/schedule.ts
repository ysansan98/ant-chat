import type { AutomationSchedule } from '@ant-chat/shared'
import { Cron } from 'croner'

export function getNextRunAt(schedule: AutomationSchedule, after: number): number | undefined {
  if (schedule.type === 'once')
    return schedule.runAt > after ? schedule.runAt : undefined

  assertFivePartCron(schedule.expression)
  const next = new Cron(schedule.expression, { timezone: schedule.timezone }).nextRun(new Date(after))
  return next?.getTime()
}

export function validateSchedule(schedule: AutomationSchedule, now = Date.now()): number {
  if (schedule.type === 'once') {
    if (schedule.runAt <= now)
      throw new Error('一次性任务的执行时间必须晚于当前时间')
    return schedule.runAt
  }

  const next = getNextRunAt(schedule, now)
  if (!next)
    throw new Error('Cron 表达式没有可执行的未来时间')
  return next
}

function assertFivePartCron(expression: string) {
  if (expression.trim().split(/\s+/).length !== 5)
    throw new Error('Cron 表达式必须使用五段格式')
}
