import type { AgentPendingAction, AgentRuntimeConfig, AgentTaskSnapshot, HookAggregateResult, HookEvent, HookInput, IAgentEventEmitter, IHookDispatcher, ILogger } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { TaskStore } from '../../taskStore'
import { ToolRegistry } from '../../tools/toolRegistry'
import { createHookAwareToolAuthorization } from '../hookToolAuthorization'

function createEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnFinished: vi.fn(),
  }
}

function createLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: {
      taskId: 'task-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-1',
      workspacePath: process.cwd(),
      mode: 'hybrid' as const,
      status: 'running' as const,
      prompt: 'test',
      createdAt: 1000,
      updatedAt: 1000,
      ...overrides,
    } as AgentTaskSnapshot,
    abortController: new AbortController(),
  }
}

const commandHost = {
  status: 'available' as const,
  platform: 'posix' as const,
  adapter: 'bash' as const,
  interpreter: 'bash' as const,
  executablePath: '/bin/bash',
  environment: { PATH: process.env.PATH ?? '', HOME: process.cwd() },
}

async function createPrepared() {
  const registry = await ToolRegistry.create({
    config: { commandHost, eventEmitter: createEmitter(), logger: createLogger() },
    workspacePath: process.cwd(),
    mode: 'hybrid',
    turnSource: { type: 'interactive' },
    runId: 'run-1',
  })
  return registry.prepare('read_file', { path: 'a.txt' })
}

function createHooks(result: Partial<HookAggregateResult>): IHookDispatcher {
  return {
    run: vi.fn(async (event: HookEvent, _input: HookInput): Promise<HookAggregateResult> => ({
      event,
      executions: [],
      ...result,
    })),
  }
}

describe('createHookAwareToolAuthorization', () => {
  it('base 已 block 时不运行 hook（hook 只收紧，不能放宽）', async () => {
    const hooks = createHooks({})
    const authorization = createHookAwareToolAuthorization(
      async () => ({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '策略阻断' }),
      { taskStore: new TaskStore() },
    )
    const result = await authorization({
      task: createTask(),
      prepared: await createPrepared() as never,
      config: { eventEmitter: createEmitter(), logger: createLogger(), hooks },
      step: 1,
      toolCallId: 'tc-1',
    })
    expect(result).toEqual({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '策略阻断' })
    expect(hooks.run).not.toHaveBeenCalled()
  })

  it('hook deny 转为 blocked 且 continueAgent=true', async () => {
    const hooks = createHooks({ decision: 'deny', reason: '禁止读取密钥' })
    const authorization = createHookAwareToolAuthorization(async () => ({ outcome: 'allow' }), { taskStore: new TaskStore() })
    const result = await authorization({
      task: createTask(),
      prepared: await createPrepared() as never,
      config: { eventEmitter: createEmitter(), logger: createLogger(), hooks },
      step: 1,
      toolCallId: 'tc-1',
    })
    expect(result).toMatchObject({ outcome: 'block', errorCode: 'AGENT_HOOK_DENIED', reason: '禁止读取密钥', continueAgent: true })
  })

  it('hook allow 的 additionalContext 透传', async () => {
    const hooks = createHooks({ additionalContext: '公司规范：先读文档' })
    const authorization = createHookAwareToolAuthorization(async () => ({ outcome: 'allow' }), { taskStore: new TaskStore() })
    const result = await authorization({
      task: createTask(),
      prepared: await createPrepared() as never,
      config: { eventEmitter: createEmitter(), logger: createLogger(), hooks },
      step: 1,
      toolCallId: 'tc-1',
    })
    expect(result).toEqual({ outcome: 'allow', additionalContext: '公司规范：先读文档' })
  })

  it('hook ask 经用户批准后放行', async () => {
    const hooks = createHooks({ decision: 'ask', reason: '需要确认' })
    const store = new TaskStore()
    const task = createTask()
    store.reserve(task)
    let captured: AgentPendingAction | undefined
    const emitter = createEmitter()
    emitter.emitApprovalRequired = vi.fn((_taskId, _conversationId, pendingAction) => {
      captured = pendingAction
    })
    const authorization = createHookAwareToolAuthorization(async () => ({ outcome: 'allow' }), { taskStore: store })

    const pending = authorization({
      task,
      prepared: await createPrepared() as never,
      config: { eventEmitter: emitter, logger: createLogger(), hooks },
      step: 1,
      toolCallId: 'tc-1',
    })
    await vi.waitFor(() => expect(captured).toBeDefined())
    expect(captured?.hookReason).toBe('需要确认')
    store.approve(task.snapshot.taskId, captured!.actionId)
    await expect(pending).resolves.toEqual({ outcome: 'allow' })
  })

  it('hook ask 被用户拒绝后阻断', async () => {
    const hooks = createHooks({ decision: 'ask', reason: '需要确认' })
    const store = new TaskStore()
    const task = createTask()
    store.reserve(task)
    let captured: AgentPendingAction | undefined
    const emitter = createEmitter()
    emitter.emitApprovalRequired = vi.fn((_taskId, _conversationId, pendingAction) => {
      captured = pendingAction
    })
    const authorization = createHookAwareToolAuthorization(async () => ({ outcome: 'allow' }), { taskStore: store })

    const pending = authorization({
      task,
      prepared: await createPrepared() as never,
      config: { eventEmitter: emitter, logger: createLogger(), hooks },
      step: 1,
      toolCallId: 'tc-1',
    })
    await vi.waitFor(() => expect(captured).toBeDefined())
    store.reject(task.snapshot.taskId, captured!.actionId, '不允许')
    const result = await pending
    expect(result).toMatchObject({ outcome: 'block', continueAgent: true })
  })

  it('automation turn 的 hook ask 降级为 block，不进入审批', async () => {
    const hooks = createHooks({ decision: 'ask', reason: '需要确认' })
    const store = new TaskStore()
    const task = createTask({ turnSource: { type: 'automation', runId: 'run-1', permissionPolicy: { allowMcpTools: false, allowBrowser: false, allowCommandExecution: true, workspaceAccess: 'read', commandPatterns: [] } } })
    store.reserve(task)
    const emitter = createEmitter()
    const authorization = createHookAwareToolAuthorization(async () => ({ outcome: 'allow' }), { taskStore: store })

    const result = await authorization({
      task,
      prepared: await createPrepared() as never,
      config: { eventEmitter: emitter, logger: createLogger(), hooks } as AgentRuntimeConfig,
      step: 1,
      toolCallId: 'tc-1',
    })
    expect(result).toMatchObject({ outcome: 'block', errorCode: 'AGENT_HOOK_ASK_BLOCKED', continueAgent: true })
    expect(emitter.emitApprovalRequired).not.toHaveBeenCalled()
  })

  it('hook 运行抛错时按无决策继续（失败隔离）', async () => {
    const hooks: IHookDispatcher = {
      run: vi.fn(async () => { throw new Error('runner exploded') }),
    }
    const authorization = createHookAwareToolAuthorization(async () => ({ outcome: 'allow' }), { taskStore: new TaskStore() })
    const result = await authorization({
      task: createTask(),
      prepared: await createPrepared() as never,
      config: { eventEmitter: createEmitter(), logger: createLogger(), hooks },
      step: 1,
      toolCallId: 'tc-1',
    })
    expect(result).toEqual({ outcome: 'allow' })
  })

  it('permissionRequest deny 时不弹审批卡片，直接阻断', async () => {
    const run = vi.fn(async (event: HookEvent): Promise<HookAggregateResult> => event === 'PermissionRequest'
      ? { event, executions: [], decision: 'deny', reason: '审批被 hook 拒绝' }
      : { event, executions: [], decision: 'ask', reason: '需要确认' })
    const store = new TaskStore()
    const task = createTask()
    store.reserve(task)
    const emitter = createEmitter()
    const authorization = createHookAwareToolAuthorization(async () => ({ outcome: 'allow' }), { taskStore: store })

    const result = await authorization({
      task,
      prepared: await createPrepared() as never,
      config: { eventEmitter: emitter, logger: createLogger(), hooks: { run } as IHookDispatcher },
      step: 1,
      toolCallId: 'tc-1',
    })

    expect(result).toMatchObject({ outcome: 'block', errorCode: 'AGENT_HOOK_DENIED', reason: '审批被 hook 拒绝', continueAgent: true })
    expect(emitter.emitApprovalRequired).not.toHaveBeenCalled()
  })
})
