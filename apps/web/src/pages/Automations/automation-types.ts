import type { AllAvailableModelsSchema, McpConnection, SkillManifest, WorkspaceItem } from '@ant-chat/shared'

export interface AutomationItem {
  id: string
  name: string
  prompt: string
  workspace: string
  workspacePath: string
  model: string
  scheduleDetail: string
  nextRun: string
  lastRun: string
  enabled: boolean
  status: 'success' | 'waiting'
}

export interface AutomationContextOptions {
  workspaces: WorkspaceItem[]
  modelGroups: AllAvailableModelsSchema[]
  skills: SkillManifest[]
  mcpServers: McpConnection[]
}

export type ScheduleMode = 'once' | 'cron'
export type RepeatKind = 'daily' | 'weekly' | 'monthly' | 'custom'
