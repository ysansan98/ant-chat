import type { AutomationDefinition, AutomationRun } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeEventBus } from '../../events'
import { createAutomationRuntime } from '../automationRuntime'

describe('automationRuntime', () => {
  it('initialize 领取到期任务并启动绑定权限的 Turn', async () => {
    const automation = definition()
    const queued = run({ status: 'queued' })
    const running = run({ status: 'running', startedAt: 2_000 })
    const linked = run({ status: 'running', startedAt: 2_000, taskId: 'task-1', conversationId: 'conversation-1', turnId: 'turn-1' })
    const repository = {
      listDue: vi.fn(async () => [automation]),
      claim: vi.fn(async () => queued),
      getEarliestNextRunAt: vi.fn(async () => undefined),
      updateRun: vi.fn().mockResolvedValueOnce(running).mockResolvedValueOnce(linked),
      cancelRunning: vi.fn(),
    }
    const startTurn = vi.fn(async () => ({ taskId: 'task-1', conversationId: 'conversation-1', userMessageId: 'turn-1' }))
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn,
      cancelTask: vi.fn(),
      events: new RuntimeEventBus(),
      clock: { now: () => 2_000 },
    })

    await runtime.initialize()

    expect(repository.claim).toHaveBeenCalledOnce()
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
      turnSource: expect.objectContaining({
        type: 'automation',
        automationId: automation.id,
        runId: queued.id,
        allowedSkills: ['review'],
        allowedMcpServers: ['github'],
      }),
    }))
    expect(repository.updateRun).toHaveBeenLastCalledWith(queued.id, expect.objectContaining({
      taskId: 'task-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    }))
    await runtime.dispose()
  })

  it('delete 默认保护活跃运行，force 时取消任务并删除定义', async () => {
    const active = run({ status: 'running', taskId: 'task-1' })
    const cancelled = run({ status: 'cancelled', taskId: 'task-1', finishedAt: 2_000 })
    const repository = {
      listRuns: vi.fn(async () => [active]),
      updateRun: vi.fn(async () => cancelled),
      delete: vi.fn(),
      getEarliestNextRunAt: vi.fn(async () => undefined),
      cancelRunning: vi.fn(),
    }
    const cancelTask = vi.fn()
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn: vi.fn(),
      cancelTask,
      events: new RuntimeEventBus(),
      clock: { now: () => 2_000 },
    })

    await expect(runtime.delete('automation-1')).rejects.toThrow('存在活跃运行')
    expect(repository.delete).not.toHaveBeenCalled()

    await runtime.delete('automation-1', { force: true })

    expect(cancelTask).toHaveBeenCalledWith('task-1')
    expect(repository.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'cancelled' }))
    expect(repository.delete).toHaveBeenCalledWith('automation-1')
    await runtime.dispose()
  })

  it('force delete 等待尚未获得 taskId 的执行，并取消晚到的任务后再删除', async () => {
    const automation = definition()
    let currentRun = run({ status: 'queued' })
    let resolveStart!: (value: { taskId: string, conversationId: string, userMessageId: string }) => void
    const startTurn = vi.fn(() => new Promise<{ taskId: string, conversationId: string, userMessageId: string }>((resolve) => {
      resolveStart = resolve
    }))
    const repository = {
      getById: vi.fn(async () => automation),
      createManualRun: vi.fn(async () => currentRun),
      listRuns: vi.fn(async () => [currentRun]),
      updateRun: vi.fn(async (_id: string, patch: Partial<AutomationRun>) => {
        currentRun = { ...currentRun, ...patch }
        return currentRun
      }),
      delete: vi.fn(),
      getEarliestNextRunAt: vi.fn(async () => undefined),
      cancelRunning: vi.fn(),
    }
    const cancelTask = vi.fn()
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn,
      cancelTask,
      events: new RuntimeEventBus(),
      clock: { now: () => 2_000 },
    })

    const execution = runtime.runNow(automation.id)
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledOnce())
    const deletion = runtime.delete(automation.id, { force: true })
    await vi.waitFor(() => expect(repository.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'cancelled' })))
    expect(repository.delete).not.toHaveBeenCalled()

    resolveStart({ taskId: 'late-task', conversationId: 'late-conversation', userMessageId: 'late-turn' })
    await Promise.all([execution, deletion])

    expect(cancelTask).toHaveBeenCalledWith('late-task')
    expect(currentRun.status).toBe('cancelled')
    expect(currentRun.taskId).toBeUndefined()
    expect(repository.delete).toHaveBeenCalledWith(automation.id)
    await runtime.dispose()
  })

  it('force delete 重新发现已通过取消检查但尚未持久化的 taskId', async () => {
    const automation = definition()
    let currentRun = run({ status: 'queued' })
    let releaseTaskLink!: () => void
    let notifyTaskLinkStarted!: () => void
    const taskLinkStarted = new Promise<void>((resolve) => {
      notifyTaskLinkStarted = resolve
    })
    const taskLinkReleased = new Promise<void>((resolve) => {
      releaseTaskLink = resolve
    })
    const repository = {
      getById: vi.fn(async () => automation),
      createManualRun: vi.fn(async () => currentRun),
      listRuns: vi.fn(async () => [currentRun]),
      updateRun: vi.fn(async (_id: string, patch: Partial<AutomationRun>) => {
        if (patch.taskId) {
          notifyTaskLinkStarted()
          await taskLinkReleased
        }
        currentRun = { ...currentRun, ...patch }
        return currentRun
      }),
      delete: vi.fn(),
      getEarliestNextRunAt: vi.fn(async () => undefined),
      cancelRunning: vi.fn(),
    }
    const cancelTask = vi.fn()
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn: vi.fn(async () => ({ taskId: 'racing-task', conversationId: 'racing-conversation', userMessageId: 'racing-turn' })),
      cancelTask,
      events: new RuntimeEventBus(),
      clock: { now: () => 2_000 },
    })

    const execution = runtime.runNow(automation.id)
    await taskLinkStarted
    const deletion = runtime.delete(automation.id, { force: true })
    await vi.waitFor(() => expect(repository.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'cancelled' })))

    releaseTaskLink()
    await Promise.all([execution, deletion])

    expect(cancelTask).toHaveBeenCalledWith('racing-task')
    expect(currentRun).toEqual(expect.objectContaining({ status: 'cancelled', taskId: 'racing-task' }))
    expect(repository.delete).toHaveBeenCalledWith(automation.id)
    await runtime.dispose()
  })

  it('task success 只收尾一次并清除 task mapping', async () => {
    const automation = definition()
    const linked = run({ status: 'running', taskId: 'task-1', conversationId: 'conversation-1' })
    const succeeded = run({ status: 'succeeded', taskId: 'task-1', conversationId: 'conversation-1', finishedAt: 2_000 })
    const repository = {
      getById: vi.fn(async () => automation),
      createManualRun: vi.fn(async () => run({ status: 'queued' })),
      updateRun: vi.fn(async (_id: string, patch: Partial<AutomationRun>) => {
        if (patch.status === 'running')
          return run({ status: 'running', startedAt: 2_000 })
        if (patch.status === 'succeeded')
          return succeeded
        return linked
      }),
      cancelRunning: vi.fn(),
    }
    const events = new RuntimeEventBus()
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn: vi.fn(async () => ({ taskId: 'task-1', conversationId: 'conversation-1', userMessageId: 'turn-1' })),
      cancelTask: vi.fn(),
      events,
      clock: { now: () => 2_000 },
    })
    await runtime.runNow(automation.id)

    const taskEvent = { task: { taskId: 'task-1', status: 'success' } } as never
    events.emit('agent:task-updated', taskEvent)
    events.emit('agent:task-updated', taskEvent)
    await vi.waitFor(() => {
      expect(repository.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'succeeded' }))
    })

    const finishCalls = repository.updateRun.mock.calls.filter(([, patch]) => patch.status === 'succeeded')
    expect(finishCalls).toHaveLength(1)
    await runtime.dispose()
  })

  it('终态持久化失败后允许同一事件重试', async () => {
    const automation = definition()
    let currentRun = run({ status: 'queued' })
    let finishAttempts = 0
    const repository = {
      getById: vi.fn(async () => automation),
      createManualRun: vi.fn(async () => currentRun),
      updateRun: vi.fn(async (_id: string, patch: Partial<AutomationRun>) => {
        if (patch.status === 'succeeded' && ++finishAttempts === 1)
          throw new Error('database unavailable')
        currentRun = { ...currentRun, ...patch }
        return currentRun
      }),
      cancelRunning: vi.fn(),
    }
    const events = new RuntimeEventBus()
    const logger = { error: vi.fn() }
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn: vi.fn(async () => ({ taskId: 'task-1', conversationId: 'conversation-1', userMessageId: 'turn-1' })),
      cancelTask: vi.fn(),
      events,
      logger: logger as never,
      clock: { now: () => 2_000 },
    })
    await runtime.runNow(automation.id)
    const terminalEvent = {
      task: {
        taskId: 'task-1',
        status: 'success',
        turnSource: { type: 'automation', automationId: automation.id, runId: currentRun.id },
      },
    } as never

    events.emit('agent:task-updated', terminalEvent)
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce())
    events.emit('agent:task-updated', terminalEvent)

    await vi.waitFor(() => expect(currentRun.status).toBe('succeeded'))
    expect(finishAttempts).toBe(2)
    await runtime.dispose()
  })

  it('startTurn 返回前到达终态事件时仍能按 turnSource 收尾', async () => {
    const automation = definition()
    let currentRun = run({ status: 'queued' })
    const repository = {
      getById: vi.fn(async () => automation),
      createManualRun: vi.fn(async () => currentRun),
      updateRun: vi.fn(async (_id: string, patch: Partial<AutomationRun>) => {
        currentRun = { ...currentRun, ...patch }
        return currentRun
      }),
      cancelRunning: vi.fn(),
    }
    const events = new RuntimeEventBus()
    const startTurn = vi.fn(async () => {
      events.emit('agent:task-updated', {
        task: {
          taskId: 'fast-task',
          conversationId: 'fast-conversation',
          userMessageId: 'fast-message',
          workspacePath: automation.workspacePath,
          mode: 'strict',
          status: 'failed',
          createdAt: 2_000,
          updatedAt: 2_000,
          prompt: automation.prompt,
          turnSource: {
            type: 'automation',
            automationId: automation.id,
            runId: currentRun.id,
            allowedSkills: automation.allowedSkills,
            allowedMcpServers: automation.allowedMcpServers,
            permissionPolicy: automation.permissionPolicy,
          },
          errorMessage: '快速失败',
        },
      })
      return { taskId: 'fast-task', conversationId: 'fast-conversation', userMessageId: 'fast-turn' }
    })
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn,
      cancelTask: vi.fn(),
      events,
      clock: { now: () => 2_000 },
    })

    const completed = await runtime.runNow(automation.id)

    expect(completed).toEqual(expect.objectContaining({
      status: 'failed',
      taskId: 'fast-task',
      conversationId: 'fast-conversation',
      errorMessage: '快速失败',
    }))
    await runtime.dispose()
  })

  it('startTurn 返回前请求秘密信息时仍能转为 needs_attention', async () => {
    const automation = definition()
    let currentRun = run({ status: 'queued' })
    const repository = {
      getById: vi.fn(async () => automation),
      createManualRun: vi.fn(async () => currentRun),
      updateRun: vi.fn(async (_id: string, patch: Partial<AutomationRun>) => {
        currentRun = { ...currentRun, ...patch }
        return currentRun
      }),
      cancelRunning: vi.fn(),
    }
    const events = new RuntimeEventBus()
    const cancelTask = vi.fn()
    const startTurn = vi.fn(async () => {
      events.emit('agent:secret-requested', {
        request: {
          requestId: 'secret-1',
          runId: 'fast-task',
          automationRunId: currentRun.id,
          conversationId: 'fast-conversation',
          label: '部署凭据',
          fields: [{ key: 'value', label: '部署凭据' }],
          createdAt: 2_000,
        },
      })
      return { taskId: 'fast-task', conversationId: 'fast-conversation', userMessageId: 'fast-turn' }
    })
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn,
      cancelTask,
      events,
      clock: { now: () => 2_000 },
    })

    const completed = await runtime.runNow(automation.id)

    expect(completed).toEqual(expect.objectContaining({
      status: 'needs_attention',
      taskId: 'fast-task',
      errorCode: 'AUTOMATION_SECRET_REQUIRED',
    }))
    expect(cancelTask).toHaveBeenCalledWith('fast-task')
    await runtime.dispose()
  })

  it('awaiting approval 取消 task 并将 run 收口为 needs_attention', async () => {
    const automation = definition()
    const linked = run({ status: 'running', taskId: 'task-1', conversationId: 'conversation-1' })
    const attention = run({ status: 'needs_attention', taskId: 'task-1', conversationId: 'conversation-1', finishedAt: 2_000 })
    const repository = {
      getById: vi.fn(async () => automation),
      createManualRun: vi.fn(async () => run({ status: 'queued' })),
      updateRun: vi.fn(async (_id: string, patch: Partial<AutomationRun>) => {
        if (patch.status === 'running')
          return run({ status: 'running', startedAt: 2_000 })
        if (patch.status === 'needs_attention')
          return attention
        return linked
      }),
      cancelRunning: vi.fn(),
    }
    const events = new RuntimeEventBus()
    const cancelTask = vi.fn()
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn: vi.fn(async () => ({ taskId: 'task-1', conversationId: 'conversation-1', userMessageId: 'turn-1' })),
      cancelTask,
      events,
      clock: { now: () => 2_000 },
    })
    await runtime.runNow(automation.id)

    events.emit('agent:task-updated', { task: { taskId: 'task-1', status: 'awaiting_approval' } } as never)

    await vi.waitFor(() => {
      expect(repository.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'needs_attention',
        errorMessage: '任务需要额外授权',
      }))
    })
    expect(cancelTask).toHaveBeenCalledWith('task-1')
    await runtime.dispose()
  })

  it('权限策略阻断时将自动化收口为 needs_attention', async () => {
    const automation = definition()
    const repository = {
      getById: vi.fn(async () => automation),
      createManualRun: vi.fn(async () => run({ status: 'queued' })),
      updateRun: vi.fn(async (_id: string, patch: Partial<AutomationRun>) => run({
        status: patch.status ?? 'running',
        taskId: patch.taskId ?? 'task-1',
        conversationId: patch.conversationId ?? 'conversation-1',
        errorCode: patch.errorCode,
        errorMessage: patch.errorMessage,
        summary: patch.summary,
        finishedAt: patch.finishedAt,
      })),
      cancelRunning: vi.fn(),
    }
    const events = new RuntimeEventBus()
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn: vi.fn(async () => ({ taskId: 'task-1', conversationId: 'conversation-1', userMessageId: 'turn-1' })),
      cancelTask: vi.fn(),
      events,
      clock: { now: () => 2_000 },
    })
    await runtime.runNow(automation.id)

    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        status: 'failed',
        errorCode: 'AGENT_POLICY_BLOCKED',
        errorMessage: '自动化任务未授权浏览器操作',
      },
    } as never)

    await vi.waitFor(() => expect(repository.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      status: 'needs_attention',
      errorCode: 'AGENT_POLICY_BLOCKED',
      errorMessage: '自动化任务未授权浏览器操作',
    })))
    await runtime.dispose()
  })

  it('dispose 停止排程、取消映射任务、修复运行状态并解绑事件', async () => {
    const automation = definition()
    const linked = run({ status: 'running', taskId: 'task-1', conversationId: 'conversation-1' })
    const timer = { id: 1 }
    const clearTimeout = vi.fn()
    const repository = {
      listDue: vi.fn(async () => []),
      getEarliestNextRunAt: vi.fn(async () => 5_000),
      getById: vi.fn(async () => automation),
      createManualRun: vi.fn(async () => run({ status: 'queued' })),
      updateRun: vi.fn(async (_id: string, patch: Partial<AutomationRun>) => {
        return patch.status === 'running' ? run({ status: 'running', startedAt: 2_000 }) : linked
      }),
      cancelRunning: vi.fn(),
    }
    const events = new RuntimeEventBus()
    const cancelTask = vi.fn()
    const runtime = createAutomationRuntime({
      repository: repository as never,
      startTurn: vi.fn(async () => ({ taskId: 'task-1', conversationId: 'conversation-1', userMessageId: 'turn-1' })),
      cancelTask,
      events,
      clock: {
        now: () => 2_000,
        setTimeout: vi.fn(() => timer),
        clearTimeout,
      },
    })
    await runtime.initialize()
    await runtime.runNow(automation.id)

    await runtime.dispose()

    expect(clearTimeout).toHaveBeenCalledWith(timer)
    expect(cancelTask).toHaveBeenCalledWith('task-1')
    expect(repository.cancelRunning).toHaveBeenCalledWith(2_000)
    const callsBeforeEvent = repository.updateRun.mock.calls.length
    events.emit('agent:task-updated', { task: { taskId: 'task-1', status: 'success' } } as never)
    await Promise.resolve()
    expect(repository.updateRun).toHaveBeenCalledTimes(callsBeforeEvent)
  })
})

function definition(): AutomationDefinition {
  return {
    id: 'automation-1',
    name: '每日检查',
    prompt: '检查代码',
    workspacePath: '/workspace',
    providerId: 'provider-1',
    modelId: 'model-1',
    allowedSkills: ['review'],
    allowedMcpServers: ['github'],
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
    nextRunAt: 1_000,
    createdAt: 1,
    updatedAt: 1,
  }
}

function run(overrides: Partial<AutomationRun>): AutomationRun {
  return {
    id: 'run-1',
    automationId: 'automation-1',
    scheduledAt: 1_000,
    status: 'queued',
    createdAt: 1_000,
    ...overrides,
  }
}
