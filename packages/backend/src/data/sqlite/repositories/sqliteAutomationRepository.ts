import type { AutomationDefinition, AutomationInput, AutomationRun, UpdateAutomationInput } from '@ant-chat/shared'
import type { AutomationRepository } from '../../repositories'
import type { AppDataDatabase } from '../types'
import { AutomationInputSchema, AutomationPermissionPolicySchema, AutomationScheduleSchema } from '@ant-chat/shared'
import { nanoid } from 'nanoid'
import { z } from 'zod'

interface AutomationRow {
  id: string
  name: string
  prompt: string
  workspace_path: string
  provider_id: string
  model_id: string
  allowed_skills: string
  allowed_mcp_servers: string
  permission_policy: string
  schedule: string
  enabled: number
  next_run_at: number | null
  last_run_at: number | null
  created_at: number
  updated_at: number
}

interface RunRow {
  id: string
  automation_id: string
  scheduled_at: number
  started_at: number | null
  finished_at: number | null
  status: AutomationRun['status']
  task_id: string | null
  conversation_id: string | null
  turn_id: string | null
  summary: string | null
  error_code: string | null
  error_message: string | null
  created_at: number
}

const AUTOMATION_COLUMNS = 'id, name, prompt, workspace_path, provider_id, model_id, allowed_skills, allowed_mcp_servers, permission_policy, schedule, enabled, next_run_at, last_run_at, created_at, updated_at'
const RUN_COLUMNS = 'id, automation_id, scheduled_at, started_at, finished_at, status, task_id, conversation_id, turn_id, summary, error_code, error_message, created_at'

export class SqliteAutomationRepository implements AutomationRepository {
  constructor(private readonly db: AppDataDatabase) {}

  async list() {
    return this.db.prepare<unknown[], AutomationRow>(`SELECT ${AUTOMATION_COLUMNS} FROM automations ORDER BY created_at DESC`).all().map(mapAutomation)
  }

  async getById(id: string) {
    const row = this.db.prepare<[string], AutomationRow>(`SELECT ${AUTOMATION_COLUMNS} FROM automations WHERE id = ?`).get(id)
    if (!row)
      throw new Error('自动化任务不存在')
    return mapAutomation(row)
  }

  async create(input: AutomationInput, nextRunAt?: number) {
    const value = AutomationInputSchema.parse(input)
    const id = `automation-${nanoid()}`
    const now = Date.now()
    this.db.prepare(`INSERT INTO automations (${AUTOMATION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      value.name,
      value.prompt,
      value.workspacePath,
      value.providerId,
      value.modelId,
      JSON.stringify(value.allowedSkills),
      JSON.stringify(value.allowedMcpServers),
      JSON.stringify(value.permissionPolicy),
      JSON.stringify(value.schedule),
      value.enabled ? 1 : 0,
      nextRunAt ?? null,
      null,
      now,
      now,
    )
    return this.getById(id)
  }

  async update(input: UpdateAutomationInput, nextRunAt?: number) {
    const current = await this.getById(input.id)
    const value = AutomationInputSchema.parse({ ...current, ...input })
    const updatedAt = Date.now()
    this.db.prepare(`UPDATE automations SET name=?, prompt=?, workspace_path=?, provider_id=?, model_id=?, allowed_skills=?, allowed_mcp_servers=?, permission_policy=?, schedule=?, enabled=?, next_run_at=?, updated_at=? WHERE id=?`).run(
      value.name,
      value.prompt,
      value.workspacePath,
      value.providerId,
      value.modelId,
      JSON.stringify(value.allowedSkills),
      JSON.stringify(value.allowedMcpServers),
      JSON.stringify(value.permissionPolicy),
      JSON.stringify(value.schedule),
      value.enabled ? 1 : 0,
      nextRunAt ?? null,
      updatedAt,
      input.id,
    )
    return this.getById(input.id)
  }

  async delete(id: string) {
    const result = this.db.prepare('DELETE FROM automations WHERE id = ?').run(id)
    if (result.changes === 0)
      throw new Error('自动化任务不存在')
  }

  async listDue(now: number) {
    return this.db.prepare<[number], AutomationRow>(`SELECT ${AUTOMATION_COLUMNS} FROM automations WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at`).all(now).map(mapAutomation)
  }

  async getEarliestNextRunAt() {
    const row = this.db.prepare<unknown[], { next_run_at: number | null }>('SELECT min(next_run_at) AS next_run_at FROM automations WHERE enabled = 1').get()
    return row?.next_run_at ?? undefined
  }

  async claim(automation: AutomationDefinition, scheduledAt: number, nextRunAt?: number) {
    const claim = this.db.transaction(() => {
      if (this.hasActiveRunSync(automation.id)) {
        const id = `run-${nanoid()}`
        const now = Date.now()
        this.db.prepare('UPDATE automations SET next_run_at = ?, last_run_at = ?, enabled = ? WHERE id = ? AND next_run_at = ?').run(
          nextRunAt ?? null,
          scheduledAt,
          automation.schedule.type === 'once' ? 0 : 1,
          automation.id,
          scheduledAt,
        )
        this.db.prepare('INSERT OR IGNORE INTO automation_runs (id, automation_id, scheduled_at, started_at, finished_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          id,
          automation.id,
          scheduledAt,
          now,
          now,
          'skipped',
          now,
        )
        return null
      }
      const id = `run-${nanoid()}`
      const now = Date.now()
      const updated = this.db.prepare('UPDATE automations SET next_run_at = ?, last_run_at = ?, enabled = ? WHERE id = ? AND next_run_at = ?').run(
        nextRunAt ?? null,
        scheduledAt,
        automation.schedule.type === 'once' ? 0 : 1,
        automation.id,
        scheduledAt,
      )
      if (updated.changes === 0)
        return null
      this.db.prepare('INSERT INTO automation_runs (id, automation_id, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?)').run(id, automation.id, scheduledAt, 'queued', now)
      return this.getRunSync(id)
    })
    return claim()
  }

  async createManualRun(automationId: string, scheduledAt: number) {
    if (this.hasActiveRunSync(automationId))
      throw new Error('AUTOMATION_ALREADY_RUNNING')
    const id = `run-${nanoid()}`
    this.db.prepare('INSERT INTO automation_runs (id, automation_id, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?)').run(id, automationId, scheduledAt, 'queued', Date.now())
    return this.getRunSync(id)
  }

  async updateRun(id: string, patch: Partial<Omit<AutomationRun, 'id' | 'automationId' | 'createdAt'>>) {
    const current = this.getRunSync(id)
    const value = { ...current, ...patch }
    this.db.prepare('UPDATE automation_runs SET scheduled_at=?, started_at=?, finished_at=?, status=?, task_id=?, conversation_id=?, turn_id=?, summary=?, error_code=?, error_message=? WHERE id=?').run(
      value.scheduledAt,
      value.startedAt ?? null,
      value.finishedAt ?? null,
      value.status,
      value.taskId ?? null,
      value.conversationId ?? null,
      value.turnId ?? null,
      value.summary ?? null,
      value.errorCode ?? null,
      value.errorMessage ?? null,
      id,
    )
    return this.getRunSync(id)
  }

  async listRuns(automationId?: string, limit = 100) {
    const rows = automationId
      ? this.db.prepare<[string, number], RunRow>(`SELECT ${RUN_COLUMNS} FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT ?`).all(automationId, limit)
      : this.db.prepare<[number], RunRow>(`SELECT ${RUN_COLUMNS} FROM automation_runs ORDER BY created_at DESC LIMIT ?`).all(limit)
    return rows.map(mapRun)
  }

  async hasActiveRun(automationId: string) {
    return this.hasActiveRunSync(automationId)
  }

  async cancelRunning(finishedAt: number) {
    this.db.prepare('UPDATE automation_runs SET status = \'cancelled\', finished_at = ? WHERE status IN (\'queued\', \'running\')').run(finishedAt)
  }

  private hasActiveRunSync(automationId: string) {
    const row = this.db.prepare<[string], { count: number }>('SELECT count(*) AS count FROM automation_runs WHERE automation_id = ? AND status IN (\'queued\', \'running\')').get(automationId)
    return (row?.count ?? 0) > 0
  }

  private getRunSync(id: string) {
    const row = this.db.prepare<[string], RunRow>(`SELECT ${RUN_COLUMNS} FROM automation_runs WHERE id = ?`).get(id)
    if (!row)
      throw new Error('自动化运行记录不存在')
    return mapRun(row)
  }
}

function mapAutomation(row: AutomationRow): AutomationDefinition {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    workspacePath: row.workspace_path,
    providerId: row.provider_id,
    modelId: row.model_id,
    allowedSkills: z.array(z.string()).parse(JSON.parse(row.allowed_skills)),
    allowedMcpServers: z.array(z.string()).parse(JSON.parse(row.allowed_mcp_servers)),
    permissionPolicy: parsePermissionPolicy(row.permission_policy),
    schedule: AutomationScheduleSchema.parse(JSON.parse(row.schedule)),
    enabled: row.enabled === 1,
    nextRunAt: row.next_run_at ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 解析权限策略，兼容存量数据中的旧字段名。
 * 存量自动化可能使用 allowSkillScripts / allowArbitraryCommands / commandPatterns /
 * allowMcpMutations，新写入使用明确的能力字段。
 */
function parsePermissionPolicy(raw: string) {
  const obj = JSON.parse(raw)
  if ('allowSkillScripts' in obj && !('allowSelectedSkillRuntime' in obj)) {
    obj.allowSelectedSkillRuntime = obj.allowSkillScripts
    delete obj.allowSkillScripts
  }
  if ('allowArbitraryCommands' in obj && !('allowBashCommands' in obj)) {
    obj.allowBashCommands = obj.allowArbitraryCommands
    delete obj.allowArbitraryCommands
  }
  if ('commandPatterns' in obj && !('bashCommandPatterns' in obj)) {
    obj.bashCommandPatterns = obj.commandPatterns
    delete obj.commandPatterns
  }
  if ('allowMcpMutations' in obj && !('allowMcpTools' in obj)) {
    obj.allowMcpTools = obj.allowMcpMutations
    delete obj.allowMcpMutations
  }
  return AutomationPermissionPolicySchema.parse(obj)
}

function mapRun(row: RunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    status: row.status,
    taskId: row.task_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    turnId: row.turn_id ?? undefined,
    summary: row.summary ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
  }
}
