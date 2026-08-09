import type { AutomationInput } from '@ant-chat/shared'
import type { Database } from 'better-sqlite3'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeAppDataSchema } from '../../schema'
import { SqliteAutomationRepository } from '../sqliteAutomationRepository'

const require = createRequire(import.meta.url)
const BetterSqlite = require('better-sqlite3') as typeof import('better-sqlite3')

const input: AutomationInput = {
  name: '每日检查',
  prompt: '检查代码',
  workspacePath: '/workspace',
  providerId: 'provider-1',
  modelId: 'model-1',
  allowedSkills: ['review'],
  allowedMcpServers: [],
  permissionPolicy: {
    workspaceAccess: 'read',
    allowSelectedSkillRuntime: false,
    allowBrowser: false,
    allowMcpTools: false,
    extraFileRoots: [],
    allowCommandExecution: false,
    commandPatterns: [],
  },
  schedule: { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
  enabled: true,
}

describe('sqliteAutomationRepository', () => {
  let db: Database
  let repository: SqliteAutomationRepository

  beforeEach(() => {
    db = new BetterSqlite(':memory:')
    initializeAppDataSchema(db)
    repository = new SqliteAutomationRepository(db)
  })

  afterEach(() => db.close())

  it('跨仓储实例保留自动化定义', async () => {
    const created = await repository.create(input, 1_000)
    const restored = await new SqliteAutomationRepository(db).getById(created.id)

    expect(restored).toEqual(expect.objectContaining({
      name: '每日检查',
      nextRunAt: 1_000,
      allowedSkills: ['review'],
    }))
  })

  it('读取存量定义时把 MCP 副作用开关迁移为显式工具能力', async () => {
    const created = await repository.create(input, 1_000)
    const legacyPolicy = { ...input.permissionPolicy, allowMcpMutations: true } as Record<string, unknown>
    delete legacyPolicy.allowMcpTools
    db.prepare('UPDATE automations SET permission_policy=? WHERE id=?').run(JSON.stringify(legacyPolicy), created.id)

    const restored = await repository.getById(created.id)

    expect(restored.permissionPolicy.allowMcpTools).toBe(true)
    expect(restored.permissionPolicy).not.toHaveProperty('allowMcpMutations')
  })

  it('同一计划时间只能领取一次并原子推进下次时间', async () => {
    const automation = await repository.create(input, 1_000)
    const first = await repository.claim(automation, 1_000, 2_000)
    const duplicate = await repository.claim(automation, 1_000, 2_000)

    expect(first?.status).toBe('queued')
    expect(duplicate).toBeNull()
    await expect(repository.getById(automation.id)).resolves.toEqual(expect.objectContaining({ nextRunAt: 2_000, lastRunAt: 1_000 }))
  })

  it('删除定义时级联删除运行记录', async () => {
    const automation = await repository.create(input, 1_000)
    await repository.createManualRun(automation.id, 500)
    await repository.delete(automation.id)

    await expect(repository.listRuns(automation.id)).resolves.toEqual([])
  })

  it('持久化运行对应的 Agent Turn', async () => {
    const automation = await repository.create(input, 1_000)
    const run = await repository.createManualRun(automation.id, 500)

    await repository.updateRun(run.id, {
      status: 'running',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    })

    await expect(repository.listRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({ turnId: 'turn-1' }),
    ])
  })

  it('上一次仍在运行时跳过本次并继续推进计划', async () => {
    const automation = await repository.create(input, 1_000)
    const active = await repository.createManualRun(automation.id, 500)
    await repository.updateRun(active.id, { status: 'running', startedAt: 500 })

    const claimed = await repository.claim(automation, 1_000, 2_000)

    expect(claimed).toBeNull()
    await expect(repository.getById(automation.id)).resolves.toEqual(expect.objectContaining({ nextRunAt: 2_000 }))
    await expect(repository.listRuns(automation.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ scheduledAt: 1_000, status: 'skipped' }),
    ]))
  })

  it('markRunRead 设置 read_at，未读 run 的 readAt 为 undefined', async () => {
    const automation = await repository.create(input, 1_000)
    const run = await repository.createManualRun(automation.id, 500)

    await expect(repository.listRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({ id: run.id, readAt: undefined }),
    ])

    const marked = await repository.markRunRead(run.id, 1_234)
    expect(marked.readAt).toBe(1_234)
    await expect(repository.listRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({ id: run.id, readAt: 1_234 }),
    ])
  })
})
