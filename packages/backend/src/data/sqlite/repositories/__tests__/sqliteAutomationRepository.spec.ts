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
  selectedSkills: ['review'],
  selectedMcpServers: [],
  permissionPolicy: {
    workspaceAccess: 'read',
    allowSkillScripts: false,
    allowMcpMutations: false,
    extraFileRoots: [],
    allowArbitraryCommands: false,
    commandPatterns: [],
    allowNetwork: false,
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
      selectedSkills: ['review'],
    }))
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
})
