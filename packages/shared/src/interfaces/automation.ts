import type { AutomationInput, AutomationPermissionPolicy, AutomationSchedule } from '../schemas/automation'

export type { AutomationInput, AutomationPermissionPolicy, AutomationSchedule } from '../schemas/automation'

/**
 * 自动化 run 的执行态（正交于查看态 readAt）。
 *
 * 无人值守下「是否成功」没有可靠判定手段（模型总结不可信、权限拒绝可能被吞），
 * 因此不提供 succeeded/failed 判定；run 只回答两件事：
 * - 执行到哪了：queued / running / completed / skipped / cancelled
 * - 是否卡住等你操作：awaiting（审批、秘密，run 已终态收口）
 */
export type AutomationRunStatus = 'queued' | 'running' | 'completed' | 'skipped' | 'cancelled' | 'awaiting'

export interface AutomationDefinition extends AutomationInput {
  id: string
  nextRunAt?: number
  lastRunAt?: number
  createdAt: number
  updatedAt: number
}

export interface AutomationRun {
  id: string
  automationId: string
  scheduledAt: number
  startedAt?: number
  finishedAt?: number
  status: AutomationRunStatus
  /** 查看态（inbox 语义）：用户打开该 run 的时间；undefined = 未读 */
  readAt?: number
  taskId?: string
  conversationId?: string
  turnId?: string
  summary?: string
  errorCode?: string
  errorMessage?: string
  createdAt: number
}

export interface UpdateAutomationInput extends Partial<Omit<AutomationInput, 'permissionPolicy' | 'schedule'>> {
  id: string
  permissionPolicy?: AutomationPermissionPolicy
  schedule?: AutomationSchedule
}
