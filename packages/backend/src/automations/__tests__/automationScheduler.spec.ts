import type { AutomationDefinition, AutomationRun } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { createAutomationScheduler } from '../automationScheduler'

describe('automationScheduler', () => {
  it('启动时领取离线期间到期的任务且只执行一次', async () => {
    const automation = {
      id: 'automation-1',
      name: '每日检查',
      prompt: '检查代码',
      workspacePath: '/workspace',
      providerId: 'provider-1',
      modelId: 'model-1',
      allowedSkills: [],
      allowedMcpServers: [],
      permissionPolicy: {
        workspaceAccess: 'read',
        allowSkillScripts: false,
        allowMcpMutations: false,
        extraFileRoots: [],
        allowBashCommands: false,
        bashCommandPatterns: [],
      },
      schedule: { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
      enabled: true,
      nextRunAt: 1_000,
      createdAt: 1,
      updatedAt: 1,
    } satisfies AutomationDefinition
    const run = { id: 'run-1', automationId: automation.id, scheduledAt: 1_000, status: 'queued', createdAt: 1_000 } satisfies AutomationRun
    const execute = vi.fn(async () => {})
    const repository = {
      listDue: vi.fn(async () => [automation]),
      claim: vi.fn(async () => run),
      getEarliestNextRunAt: vi.fn(async () => undefined),
    }
    const scheduler = createAutomationScheduler({ repository: repository as never, execute, now: () => 2_000 })

    await scheduler.start()

    expect(repository.claim).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(automation, 'run-1')
    scheduler.dispose()
  })
})
