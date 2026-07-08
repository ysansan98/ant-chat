import type { AllAvailableModelsSchema, AutomationDefinition, AutomationRun } from '@ant-chat/shared'
import type { AutomationItem, RepeatKind } from './automation-types'

export const weekdays = [
  { value: '1', label: '一' },
  { value: '2', label: '二' },
  { value: '3', label: '三' },
  { value: '4', label: '四' },
  { value: '5', label: '五' },
  { value: '6', label: '六' },
  { value: '0', label: '日' },
]

export function buildCron(kind: RepeatKind, time: string, selectedDays: string[], monthDay: string, customCron: string) {
  if (kind === 'custom')
    return customCron

  const [hour = '0', minute = '0'] = time.split(':')
  if (kind === 'daily')
    return `${minute} ${hour} * * *`
  if (kind === 'monthly')
    return `${minute} ${hour} ${monthDay} * *`
  const orderedDays = weekdays.filter(day => selectedDays.includes(day.value)).map(day => day.value)
  return `${minute} ${hour} * * ${orderedDays.join(',')}`
}

export function describeNextRun(kind: RepeatKind, time: string, selectedDays: string[], monthDay: string) {
  if (kind === 'daily')
    return `明天 ${time}`
  if (kind === 'monthly')
    return `下个 ${monthDay} 日 ${time}`
  if (kind === 'custom')
    return '按 cron 表达式计算'
  return `下一个周${formatWeekdays(selectedDays)} ${time}`
}

export function formatWeekdays(selectedDays: string[]) {
  return weekdays.filter(day => selectedDays.includes(day.value)).map(day => day.label).join('、')
}

export function formatDateTime(value: string) {
  const [date = '', time = ''] = value.split('T')
  return `${date} ${time}`.trim()
}

export function toAutomationItem(definition: AutomationDefinition, modelGroups: AllAvailableModelsSchema[]): AutomationItem {
  const workspace = definition.workspacePath.split('/').filter(Boolean).pop() || definition.workspacePath
  const model = modelGroups.flatMap(group => group.models).find(item => item.id === definition.modelId)?.name ?? definition.modelId
  return {
    id: definition.id,
    name: definition.name,
    prompt: definition.prompt,
    workspace,
    workspacePath: definition.workspacePath,
    model,
    scheduleDetail: definition.schedule.type === 'cron'
      ? describeCronExpression(definition.schedule.expression)
      : `仅一次 · ${formatTimestamp(definition.schedule.runAt)}`,
    nextRun: definition.nextRunAt ? formatTimestamp(definition.nextRunAt) : '无后续计划',
    lastRun: definition.lastRunAt ? formatTimestamp(definition.lastRunAt) : '尚未运行',
    enabled: definition.enabled,
    status: definition.lastRunAt ? 'success' : 'waiting',
  }
}

export function describeCronExpression(expression: string) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.trim().split(/\s+/)
  if (!minute || !hour || month !== '*')
    return '自定义周期'
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  if (dayOfMonth !== '*' && dayOfWeek === '*')
    return `每月 ${dayOfMonth} 日 · ${time}`
  if (dayOfMonth === '*' && dayOfWeek === '*')
    return `每天 · ${time}`
  if (dayOfMonth === '*' && dayOfWeek === '1-5')
    return `每个工作日 · ${time}`
  if (dayOfMonth === '*' && dayOfWeek) {
    const labels = dayOfWeek.split(',').map(day => weekdays.find(item => item.value === day)?.label).filter(Boolean)
    if (labels.length > 0)
      return `每周${labels.join('、')} · ${time}`
  }
  return '自定义周期'
}

export function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

export function formatDuration(run: AutomationRun) {
  if (!run.startedAt || !run.finishedAt)
    return '进行中'
  return `${Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000))}秒`
}

export function formatRunStatus(status: AutomationRun['status']) {
  return {
    queued: '等待执行',
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    skipped: '已跳过',
    cancelled: '已取消',
    needs_attention: '需要处理',
  }[status]
}

export function splitCommaList(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

/** 将 cron 表达式反向解析为表单字段，用于编辑模式回填 */
export function parseCronForForm(expression: string): {
  repeatKind: RepeatKind
  time: string
  selectedWeekdays: string[]
  monthDay: string
  customCron: string
} {
  const parts = expression.trim().split(/\s+/)
  if (parts.length < 5) {
    return { repeatKind: 'custom', time: '09:00', selectedWeekdays: ['1', '3', '5'], monthDay: '1', customCron: expression }
  }
  const [minute = '0', hour = '0', dayOfMonth, , dayOfWeek] = parts
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`

  if (dayOfMonth === '*' && dayOfWeek === '*') {
    return { repeatKind: 'daily', time, selectedWeekdays: [], monthDay: '1', customCron: expression }
  }
  if (dayOfMonth !== '*' && dayOfWeek === '*') {
    return { repeatKind: 'monthly', time, selectedWeekdays: [], monthDay: dayOfMonth, customCron: expression }
  }
  if (dayOfMonth === '*' && dayOfWeek) {
    const days = dayOfWeek.split(',').map(d => d.trim()).filter(Boolean)
    return { repeatKind: 'weekly', time, selectedWeekdays: days, monthDay: '1', customCron: expression }
  }

  return { repeatKind: 'custom', time: '09:00', selectedWeekdays: ['1', '3', '5'], monthDay: '1', customCron: expression }
}

/** 将毫秒时间戳转为 datetime-local input 可用的字符串 */
export function timestampToDatetimeLocal(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
