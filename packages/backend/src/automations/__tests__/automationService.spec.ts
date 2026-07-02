import type { AutomationDefinition, AutomationRun } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeEventBus } from '../../events'
import { createAutomationService } from '../automationService'

describe('automationService', () => {
  it('启动任务时把 Skill、MCP 和权限绑定到当前自动化 Turn', async () => {
    const automation = {
      id: 'automation-1',
      name: '每日检查',
      prompt: '检查代码',
      workspacePath: '/workspace',
      providerId: 'provider-1',
      modelId: 'model-1',
      selectedSkills: ['review'],
      selectedMcpServers: ['github'],
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
      nextRunAt: 1_000,
      createdAt: 1,
      updatedAt: 1,
    } satisfies AutomationDefinition
    const runningRun = { id: 'run-1', automationId: automation.id, scheduledAt: 1_000, status: 'running', createdAt: 1_000 } satisfies AutomationRun
    const linkedRun = { ...runningRun, taskId: 'task-1', conversationId: 'conv-1' } satisfies AutomationRun
    const startTurn = vi.fn(async (_input: unknown) => ({ taskId: 'task-1', conversationId: 'conv-1' }))
    const repository = {
      updateRun: vi.fn()
        .mockResolvedValueOnce(runningRun)
        .mockResolvedValueOnce(linkedRun),
      list: vi.fn(),
      listRuns: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      getById: vi.fn(),
      delete: vi.fn(),
      createManualRun: vi.fn(),
    }
    const service = createAutomationService({
      repository: repository as never,
      startTurn,
      cancelTask: vi.fn(),
      events: new RuntimeEventBus(),
    })

    await service.execute(automation, 'run-1')

    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '检查代码',
      turnSource: {
        type: 'automation',
        automationId: automation.id,
        runId: 'run-1',
        selectedSkills: ['review'],
        selectedMcpServers: ['github'],
        permissionPolicy: automation.permissionPolicy,
      },
    }))
    const startInput = startTurn.mock.calls[0]?.[0] as { prompt: string }
    expect(startInput.prompt).not.toContain('review')
    expect(startInput.prompt).not.toContain('github')
  })
})
