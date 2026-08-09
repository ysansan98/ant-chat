import type { AutomationDefinition, AutomationInput, AutomationRun, AutomationRunStatus, UpdateAutomationInput } from '@ant-chat/shared'

export interface AutomationRepository {
  list: () => Promise<AutomationDefinition[]>
  getById: (id: string) => Promise<AutomationDefinition>
  create: (input: AutomationInput, nextRunAt?: number) => Promise<AutomationDefinition>
  update: (input: UpdateAutomationInput, nextRunAt?: number) => Promise<AutomationDefinition>
  delete: (id: string) => Promise<void>
  listDue: (now: number) => Promise<AutomationDefinition[]>
  getEarliestNextRunAt: () => Promise<number | undefined>
  claim: (automation: AutomationDefinition, scheduledAt: number, nextRunAt?: number) => Promise<AutomationRun | null>
  createManualRun: (automationId: string, scheduledAt: number) => Promise<AutomationRun>
  updateRun: (id: string, patch: Partial<Omit<AutomationRun, 'id' | 'automationId' | 'createdAt'>>) => Promise<AutomationRun>
  listRuns: (automationId?: string, limit?: number) => Promise<AutomationRun[]>
  markRunRead: (id: string, readAt: number) => Promise<AutomationRun>
  hasActiveRun: (automationId: string) => Promise<boolean>
  cancelRunning: (finishedAt: number) => Promise<void>
}

export type { AutomationRunStatus }
