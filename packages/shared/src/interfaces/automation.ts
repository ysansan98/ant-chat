import type { AutomationInput, AutomationPermissionPolicy, AutomationSchedule } from '../schemas/automation'

export type { AutomationInput, AutomationPermissionPolicy, AutomationSchedule } from '../schemas/automation'

export type AutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled' | 'needs_attention'

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
