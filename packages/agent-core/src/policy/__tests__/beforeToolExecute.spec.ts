import { describe, expect, it, vi } from 'vitest'
import { createBeforeToolExecuteHook } from '../beforeToolExecute'
import type { AgentTaskSnapshot, IAgentEventEmitter, ILogger, ToolApprovalWhitelistEntry } from '@ant-chat/shared'
import type { RuntimeTask } from '../../taskStore'

function createMockEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnFinished: vi.fn(),
    emitCompactionSaved: vi.fn(),
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
    pendingResolver: undefined,
  }
}

function createPrepared() {
  return {
    toolName: 'read_file',
    source: 'native' as const,
    serverName: 'native',
    input: { path: 'test.txt' },
    operationType: 'read' as const,
    scope: 'workspace' as const,
    execute: async () => ({ ok: true, output: 'content', exitCode: 0 }),
  }
}

describe('createBeforeToolExecuteHook', () => {
  it('returns allow for workspace read in hybrid mode', async () => {
    const hook = createBeforeToolExecuteHook(async () => ({ approved: true }))
    const task = createTask({ mode: 'hybrid' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toEqual({ outcome: 'allow' })
  })

  it('returns block for blocked scope', async () => {
    const hook = createBeforeToolExecuteHook(async () => ({ approved: true }))
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

  it('returns allow for full_managed mode regardless of scope', async () => {
    const hook = createBeforeToolExecuteHook(async () => ({ approved: true }))
    const task = createTask({ mode: 'full_managed' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'blocked' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toEqual({ outcome: 'allow' })
  })

  it('sets pendingAction and awaits approval for outside scope', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createBeforeToolExecuteHook(waitForApproval)
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

  it('returns block when approval is denied', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createBeforeToolExecuteHook(waitForApproval)
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

  it('throws AGENT_CANCELLED when task is aborted during approval', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const waitForApproval = vi.fn().mockImplementation((t: RuntimeTask) => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        t.abortController.abort()
        resolve({ approved: false, reason: 'AGENT_CANCELLED' })
      })
    })

    const hook = createBeforeToolExecuteHook(waitForApproval)
    const task = createTask({ mode: 'strict' })

    await expect(
      hook({
        task,
        prepared: { ...createPrepared(), operationType: 'bash', scope: 'workspace' },
        config: { eventEmitter: emitter, logger },
      }),
    ).rejects.toThrow('Task cancelled')
  })

  it('calls onToolCallContext callback', async () => {
    const hook = createBeforeToolExecuteHook(async () => ({ approved: true }))
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

  it('auto-approves when whitelist matches', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const whitelist: ToolApprovalWhitelistEntry[] = [{
      toolName: 'write_file',
      toolScope: 'workspace',
      pattern: './src/**',
    }]

    const hook = createBeforeToolExecuteHook(
      async () => ({ approved: true }),
      () => whitelist,
    )
    const task = createTask({ mode: 'strict' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: '/workspace/src/index.ts' } },
      config: { eventEmitter: emitter, logger },
    })

    expect(result).toEqual({ outcome: 'allow' })
    expect(emitter.emitApprovalRequired).not.toHaveBeenCalled()
    expect(task.snapshot.status).toBe('running')
  })

  it('does not auto-approve when whitelist does not match', async () => {
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

    const hook = createBeforeToolExecuteHook(waitForApproval, () => whitelist)
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: '/workspace/src/index.ts' } },
      config: { eventEmitter: emitter, logger },
    })

    expect(task.snapshot.status).toBe('awaiting_approval')
    resolveApproval({ approved: true })
    const result = await resultPromise
    expect(result).toEqual({ outcome: 'allow' })
  })

  it('sends whitelistPattern and whitelistApplicableScope in pendingAction', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createBeforeToolExecuteHook(waitForApproval, () => [])
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'bash', operationType: 'bash', scope: 'workspace', input: { command: 'git log' } },
      config: { eventEmitter: emitter, logger },
    })

    expect(task.snapshot.pendingAction?.whitelistPattern).toBeDefined()

    resolveApproval({ approved: true })
    await resultPromise
  })

  it('behaves normally when getWhitelistEntries is not provided (backward compat)', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createBeforeToolExecuteHook(waitForApproval)
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
