import { describe, expect, it, vi } from 'vitest'
import { createToolAuthorization } from '../toolAuthorization'
import type { AgentTaskSnapshot, IAgentEventEmitter, ILogger, ToolApprovalWhitelistEntry } from '@ant-chat/shared'
import type { RuntimeTask, TaskStore } from '../../taskStore'

function createMockEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnFinished: vi.fn(),
  }
}

function createMockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function createTask(overrides: Record<string, unknown> = {}): RuntimeTask {
  return {
    snapshot: {
      taskId: 'task-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-1',
      workspacePath: '/workspace',
      mode: 'hybrid',
      status: 'running',
      prompt: 'test',
      createdAt: 1000,
      updatedAt: 1000,
      logPath: '',
      ...overrides,
    } as AgentTaskSnapshot,
    abortController: new AbortController(),
  }
}

function createPrepared() {
  return {
    toolName: 'read_file',
    source: 'native' as const,
    serverName: 'native',
    input: { path: 'test.txt' },
    publicInput: { path: 'test.txt' },
    operationType: 'read' as const,
    scope: 'workspace' as const,
    execute: async () => ({ ok: true, result: 'content', diagnostics: { exitCode: 0 } }),
  }
}

function createTaskState(waitForApproval: (task: RuntimeTask) => Promise<{ approved: boolean, reason?: string }>): TaskStore {
  return {
    requestApproval: async (task, pendingAction, eventEmitter) => {
      task.snapshot.status = 'awaiting_approval'
      task.snapshot.pendingAction = pendingAction
      void eventEmitter.emitTaskUpdated(task.snapshot)
      void eventEmitter.emitApprovalRequired(task.snapshot.taskId, task.snapshot.conversationId, pendingAction)
      return await waitForApproval(task)
    },
  } as TaskStore
}

describe('createToolAuthorization 行为', () => {
  it('自动化只读策略直接阻止写入且不进入交互审批', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: [],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: false,
          allowMcpMutations: false,
          extraFileRoots: [],
          allowBashCommands: false,
          bashCommandPatterns: [],
        },
      },
    })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toEqual(expect.objectContaining({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED' }))
    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('自动化策略允许执行当前 Turn 已注入的 Skill', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: ['review'],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: false,
          allowMcpMutations: false,
          extraFileRoots: [],
          allowBashCommands: false,
          bashCommandPatterns: [],
        },
      },
    })

    await expect(hook({
      task,
      prepared: { ...createPrepared(), toolName: 'use_skill', operationType: 'skill', scope: 'workspace', input: { name: 'review' }, publicInput: { name: 'review' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })

    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('hybrid 模式下 workspace read 返回 allow', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({ mode: 'hybrid' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toEqual({ outcome: 'allow' })
  })

  it('blocked scope 返回 block', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({ mode: 'strict' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'blocked' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result.outcome).toBe('block')
    if (result.outcome === 'block') {
      expect(result.errorCode).toBe('AGENT_POLICY_BLOCKED')
    }
  })

  it('full_managed 模式下无论 scope 都返回 allow', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({ mode: 'full_managed' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'blocked' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toEqual({ outcome: 'allow' })
  })

  it('outside scope 设置 pendingAction 并等待审批', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'outside' },
      config: { eventEmitter: emitter, logger },
    })

    // Should be awaiting approval
    expect(task.snapshot.status).toBe('awaiting_approval')
    expect(task.snapshot.pendingAction).toBeDefined()
    expect(task.snapshot.pendingAction?.toolName).toBe('read_file')
    expect(emitter.emitTaskUpdated).toHaveBeenCalled()
    expect(emitter.emitApprovalRequired).toHaveBeenCalled()

    // Approve
    resolveApproval({ approved: true })
    const result = await resultPromise
    expect(result).toEqual({ outcome: 'allow' })
  })

  it('审批被拒绝时返回 block', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'workspace' },
      config: { eventEmitter: emitter, logger },
    })

    // Reject
    resolveApproval({ approved: false, reason: 'User denied' })
    const result = await resultPromise

    expect(result.outcome).toBe('block')
    if (result.outcome === 'block') {
      expect(result.reason).toContain('rejected')
    }
  })

  it('审批期间任务中止时抛出 AGENT_CANCELLED', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const waitForApproval = vi.fn().mockImplementation((t: RuntimeTask) => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        t.abortController.abort()
        resolve({ approved: false, reason: 'AGENT_CANCELLED' })
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    await expect(
      hook({
        task,
        prepared: { ...createPrepared(), operationType: 'bash', scope: 'workspace' },
        config: { eventEmitter: emitter, logger },
      }),
    ).rejects.toThrow('Task cancelled')
  })

  it('调用 onToolCallContext 回调', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({ mode: 'hybrid' })
    const onContext = vi.fn()

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      onToolCallContext: onContext,
    })

    expect(result).toEqual({ outcome: 'allow' })
    expect(onContext).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'read_file',
        operationType: 'read',
        scope: 'workspace',
        policy: 'allow',
      }),
    )
  })

  it('白名单匹配时自动批准', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const whitelist: ToolApprovalWhitelistEntry[] = [{
      toolName: 'write_file',
      toolScope: 'workspace',
      pattern: './src/**',
    }]

    const hook = createToolAuthorization(
      createTaskState(async () => ({ approved: true })),
      () => whitelist,
    )
    const task = createTask({ mode: 'strict' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: '/workspace/src/index.ts' }, publicInput: { path: '/workspace/src/index.ts' } },
      config: { eventEmitter: emitter, logger },
    })

    expect(result).toEqual({ outcome: 'allow' })
    expect(emitter.emitApprovalRequired).not.toHaveBeenCalled()
    expect(task.snapshot.status).toBe('running')
  })

  it('白名单不匹配时不自动批准', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const whitelist: ToolApprovalWhitelistEntry[] = [{
      toolName: 'write_file',
      toolScope: 'workspace',
      pattern: '/safe-path/**',
    }]

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval), () => whitelist)
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: '/workspace/src/index.ts' }, publicInput: { path: '/workspace/src/index.ts' } },
      config: { eventEmitter: emitter, logger },
    })

    expect(task.snapshot.status).toBe('awaiting_approval')
    resolveApproval({ approved: true })
    const result = await resultPromise
    expect(result).toEqual({ outcome: 'allow' })
  })

  it('在 pendingAction 中发送 whitelistPattern 和 whitelistApplicableScope', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval), () => [])
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'bash', operationType: 'bash', scope: 'workspace', input: { command: 'git log' }, publicInput: { command: 'git log' } },
      config: { eventEmitter: emitter, logger },
    })

    expect(task.snapshot.pendingAction?.whitelistPattern).toBeDefined()

    resolveApproval({ approved: true })
    await resultPromise
  })

  it('未提供 getWhitelistEntries 时保持兼容行为', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'workspace' },
      config: { eventEmitter: emitter, logger },
    })

    expect(task.snapshot.status).toBe('awaiting_approval')
    resolveApproval({ approved: true })
    const result = await resultPromise
    expect(result).toEqual({ outcome: 'allow' })
  })
})
