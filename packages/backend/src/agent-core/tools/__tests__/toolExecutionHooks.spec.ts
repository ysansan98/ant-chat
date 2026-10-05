import type { AgentRuntimeConfig, AgentTaskSnapshot, HookAggregateResult, HookEvent, IAgentEventEmitter, IHookDispatcher, ILogger } from '@ant-chat/shared'
import type { ToolRegistry } from '../toolRegistry'
import { describe, expect, it, vi } from 'vitest'
import { executeToolStep } from '../toolExecution'

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

function createTask() {
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
    } as AgentTaskSnapshot,
    abortController: new AbortController(),
  }
}

/** 内存假工具：不触碰文件系统，专注验证 hooks 接线。 */
function createRegistry(): ToolRegistry {
  return {
    prepare: () => ({
      toolName: 'read_file',
      originalToolName: 'read_file',
      source: 'native',
      serverName: 'native',
      input: { path: 'a.txt' },
      operationType: 'read',
      scope: 'workspace',
      execute: async () => ({ ok: true, result: 'file content', diagnostics: { exitCode: 0 } }),
    }),
  } as unknown as ToolRegistry
}

function createHooks(): { hooks: IHookDispatcher, run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (event: HookEvent): Promise<HookAggregateResult> => ({ event, executions: [] }))
  return { hooks: { run } as IHookDispatcher, run }
}

describe('executeToolStep + hooks', () => {
  it('preToolUse 的 additionalContext 追加到工具结果上下文', async () => {
    const { hooks } = createHooks()
    const result = await executeToolStep({
      task: createTask(),
      registry: createRegistry(),
      requestedToolCall: { toolName: 'read_file', input: { path: 'a.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: createEmitter(), logger: createLogger(), hooks },
      beforeToolExecute: async () => ({ outcome: 'allow', additionalContext: 'HOOK: 注意公司规范' }),
    })
    expect(result.isError).toBe(false)
    expect(result.toolResultContent).toContain('file content')
    expect(result.toolResultContent).toContain('HOOK: 注意公司规范')
  })

  it('postToolUse 在工具成功后触发（fire-and-forget）', async () => {
    const { hooks, run } = createHooks()
    await executeToolStep({
      task: createTask(),
      registry: createRegistry(),
      requestedToolCall: { toolName: 'read_file', input: { path: 'a.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: createEmitter(), logger: createLogger(), hooks },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith('PostToolUse', expect.objectContaining({ tool_name: 'read_file', is_error: false }), expect.anything()))
  })

  it('postToolUse 失败不影响工具结果', async () => {
    const { hooks, run } = createHooks()
    run.mockRejectedValue(new Error('post hook exploded'))
    const result = await executeToolStep({
      task: createTask(),
      registry: createRegistry(),
      requestedToolCall: { toolName: 'read_file', input: { path: 'a.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: createEmitter(), logger: createLogger(), hooks },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })
    expect(result.isError).toBe(false)
    expect(result.toolResultContent).toContain('file content')
  })

  it('未注入 hooks 时行为与现状一致', async () => {
    const result = await executeToolStep({
      task: createTask(),
      registry: createRegistry(),
      requestedToolCall: { toolName: 'read_file', input: { path: 'a.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: createEmitter(), logger: createLogger() } as AgentRuntimeConfig,
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })
    expect(result.toolResultContent).toBe('file content')
  })

  it('block 结果把 hook 原因交给模型', async () => {
    const { hooks } = createHooks()
    const result = await executeToolStep({
      task: createTask(),
      registry: createRegistry(),
      requestedToolCall: { toolName: 'read_file', input: { path: 'a.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: createEmitter(), logger: createLogger(), hooks },
      beforeToolExecute: async () => ({ outcome: 'block', errorCode: 'AGENT_HOOK_DENIED', reason: 'hook 拒绝：禁止读取该文件', continueAgent: true }),
    })
    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toContain('hook 拒绝：禁止读取该文件')
  })
})
