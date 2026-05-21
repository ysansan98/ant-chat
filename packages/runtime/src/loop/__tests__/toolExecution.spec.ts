import { describe, expect, it, vi } from 'vitest'
import { createInvalidToolArgsResult, executeToolStep } from '../toolExecution'
import { ToolRegistry } from '../toolRegistry'
import type { AgentTaskSnapshot, AgentTool, IAgentEventEmitter, ILogger } from '@ant-chat/shared'

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

function createReadTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'read_file',
    source: 'native',
    description: 'Reads a file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path' } },
      required: ['path'],
    },
    operationType: 'read',
    inferScope: () => 'workspace',
    execute: async () => ({ ok: true, output: 'file content', exitCode: 0 }),
    ...overrides,
  }
}

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: {
      taskId: 'task-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-1',
      workspacePath: '/workspace',
      mode: 'hybrid' as const,
      status: 'running' as const,
      prompt: 'test',
      createdAt: 1000,
      updatedAt: 1000,
      logPath: '',
      ...overrides,
    } as AgentTaskSnapshot,
    abortController: new AbortController(),
    pendingResolver: undefined as ((v: { approved: boolean, reason?: string }) => void) | undefined,
  }
}

describe('executeToolStep', () => {
  it('executes a successful tool and returns result', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const registry = new ToolRegistry([createReadTool()])
    const task = createTask()

    const result = await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: 'Reading file...',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.toolCallId).toBeDefined()
    expect(result.isError).toBe(false)
    expect(result.toolResultContent).toContain('read_file')
    expect(result.toolResultContent).toContain('succeeded')
  })

  it('handles tool not found in registry', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const registry = new ToolRegistry([])
    const task = createTask()

    const result = await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'nonexistent', input: {} },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.isError).toBe(true)
    // Tool not found => scope is 'blocked' => execute returns error
    expect(result.toolResultContent).toContain('failed')
  })

  it('handles tool validation error', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const tool = createReadTool({
      validateInput: () => 'Path must be absolute',
    })
    const registry = new ToolRegistry([tool])
    const task = createTask()

    const result = await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: '' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toContain('Path must be absolute')
  })

  it('handles hook block result', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const registry = new ToolRegistry([createReadTool()])
    const task = createTask()

    const result = await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: {} },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({
        outcome: 'block',
        errorCode: 'AGENT_POLICY_BLOCKED',
        reason: '策略阻断，禁止执行',
      }),
    })

    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toContain('AGENT_POLICY_BLOCKED')
  })

  it('handles hook allow result with tool execution', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const registry = new ToolRegistry([createReadTool()])
    const task = createTask()

    let hookCalled = false
    const result = await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async (input) => {
        hookCalled = true
        // Verify hook receives the right prepared data
        expect(input.prepared.toolName).toBe('read_file')
        expect(input.prepared.operationType).toBe('read')
        expect(input.prepared.scope).toBe('workspace')
        return { outcome: 'allow' }
      },
    })

    expect(hookCalled).toBe(true)
    expect(result.isError).toBe(false)
  })

  it('handles tool execution failure', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const tool = createReadTool({
      execute: async () => ({ ok: false, error: 'AGENT_TOOL_EXEC_FAILED', stderr: 'permission denied', exitCode: 1 }),
    })
    const registry = new ToolRegistry([tool])
    const task = createTask()

    const result = await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'secret.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toContain('failed')
  })

  it('emits toolCall events', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const tool = createReadTool()
    const registry = new ToolRegistry([tool])
    const task = createTask()

    await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: 'Reading...',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(emitter.emitTurnToolCalls).toHaveBeenCalledTimes(2) // once at start, once at completion
  })

  it('calls onToolCallContext callback via beforeToolExecute hook', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const tool = createReadTool()
    const registry = new ToolRegistry([tool])
    const task = createTask()
    const onContext = vi.fn()

    await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async (input) => {
        // Simulate what the real hook does: call onToolCallContext
        input.onToolCallContext?.({
          toolName: input.prepared.toolName,
          input: input.prepared.input,
          operationType: input.prepared.operationType,
          scope: input.prepared.scope,
          policy: 'allow',
        })
        return { outcome: 'allow' }
      },
      onToolCallContext: onContext,
    })

    expect(onContext).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'read_file',
        operationType: 'read',
        scope: 'workspace',
      }),
    )
  })
})

describe('createInvalidToolArgsResult', () => {
  it('creates error result for invalid tool arguments', () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const result = createInvalidToolArgsResult({
      config: { eventEmitter: emitter, logger },
      conversationId: 'conv-1',
      requestedToolCall: {
        toolName: 'bash',
        input: {},
        invalidArgsError: 'command is required',
      },
      currentModelText: '',
      currentToolMessages: [],
    })

    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toContain('command is required')
    expect(result.toolCallId).toBeDefined()
    expect(emitter.emitTurnToolCalls).toHaveBeenCalled()
  })

  it('uses default error when no invalidArgsError provided', () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const result = createInvalidToolArgsResult({
      config: { eventEmitter: emitter, logger },
      conversationId: 'conv-1',
      requestedToolCall: { toolName: 'bash', input: {} },
      currentModelText: 'Executing...',
      currentToolMessages: [],
    })

    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toContain('args must be a JSON object')
  })
})
