import type { AgentTaskSnapshot } from '@ant-chat/shared'

/**
 * 任务仍在运行（含等待审批）的状态集合。
 *
 * 这是 web 端判定「会话是否在运行」的唯一来源：UI 订阅、事件对账、
 * 待处理队列触发、中止请求，全部经由 {@link isTaskActive} 走到这里，
 * 避免规则散落后「改一处忘一处」。
 */
export const ACTIVE_TASK_STATUSES: ReadonlySet<AgentTaskSnapshot['status']> = new Set([
  'running',
  'awaiting_approval',
])

/**
 * 判断任务是否仍处于活跃状态（运行中或等待审批）。
 *
 * 终态（success / failed / cancelled）返回 false。
 */
export function isTaskActive(task: Pick<AgentTaskSnapshot, 'status'>): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status)
}
