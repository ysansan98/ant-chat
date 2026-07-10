import { describe, expect, it, vi } from 'vitest'
import { createInvalidToolArgsResult, executeToolStep } from '../toolExecution'
import { ToolRegistry } from '../toolRegistry'
import type { AgentTaskSnapshot, AgentTool, IAgentEventEmitter, ILogger, McpToolCall } from '@ant-chat/shared'

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
    execute: async () => ({ ok: true, result: 'file content', diagnostics: { exitCode: 0 } }),
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
  }
}

describe('executeToolStep 行为', () => {
  it('执行成功工具并返回结果', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const registry = new ToolRegistry([createReadTool()])
    const task = createTask({ executionPhase: 'preparing_tool' })

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
    expect(result.toolResultContent).toBe('file content')
    expect(task.snapshot.executionPhase).toBe('preparing_tool')
    expect(emitter.emitTaskUpdated).not.toHaveBeenCalled()
  })

  it('每次工具调用只 prepare 一次', async () => {
    const registry = new ToolRegistry([createReadTool()])
    const prepare = vi.spyOn(registry, 'prepare')

    await executeToolStep({
      task: createTask(),
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('保留模型提供的 tool call id', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const registry = new ToolRegistry([createReadTool()])
    const task = createTask()
    const currentToolMessages: McpToolCall[] = []

    const result = await executeToolStep({
      task,
      registry,
      requestedToolCall: { id: 'model-call-1', toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: 'Reading file...',
      currentToolMessages,
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.toolCallId).toBe('model-call-1')
    expect(currentToolMessages).toEqual([
      expect.objectContaining({ id: 'model-call-1', toolName: 'read_file' }),
    ])
  })

  it('处理 registry 中找不到工具', async () => {
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
    expect(result.toolResultContent).toBe('未找到工具：nonexistent')
  })

  it('处理工具校验错误', async () => {
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

  it('处理 hook 返回 block 的结果', async () => {
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
    expect(result.toolResultContent).toBe('策略阻断，禁止执行')
  })

  it('hook 返回 allow 时执行工具', async () => {
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

  it('处理工具执行失败', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const tool = createReadTool({
      execute: async () => ({ ok: false, result: 'permission denied', diagnostics: { stderr: 'permission denied', exitCode: 1 } }),
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
    expect(result.toolResultContent).toBe('permission denied')
  })

  it('工具执行抛异常时返回工具失败并保留异常细节', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const taskLogger = { filePath: '/tmp/task.jsonl', write: vi.fn(), close: vi.fn() }
    const tool = createReadTool({
      execute: async () => {
        throw new Error('secret missing')
      },
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
      config: { eventEmitter: emitter, logger, taskLogger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toBe('secret missing')
    expect(taskLogger.write).toHaveBeenCalledWith('tool_failed', expect.objectContaining({
      error: 'AGENT_TOOL_EXEC_FAILED',
      stderr: 'secret missing',
    }))
    expect(emitter.emitTurnToolCalls).toHaveBeenCalledTimes(2)
  })

  it('失败结果只注入工具返回的 result，不做执行层包装', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const tool = createReadTool({
      execute: async () => ({
        ok: false,
        result: 'stderr:\n文件不存在\nexitCode=1',
        diagnostics: { stderr: '文件不存在', exitCode: 1 },
      }),
    })
    const registry = new ToolRegistry([tool])
    const task = createTask()

    const result = await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'missing.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toBe('stderr:\n文件不存在\nexitCode=1')
    expect(result.toolResultContent).not.toContain('Tool read_file failed')
  })

  it('发出 toolCall 事件', async () => {
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

  it('通过 beforeToolExecute hook 调用 onToolCallContext 回调', async () => {
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

  it('向 tool_completed 日志 payload 写入 durationMs', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const taskLogger = { filePath: '/tmp/task.jsonl', write: vi.fn(), close: vi.fn() }
    const registry = new ToolRegistry([createReadTool()])
    const task = createTask()

    await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: 'Reading...',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger, taskLogger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(taskLogger.write).toHaveBeenCalledWith('tool_completed', expect.objectContaining({
      durationMs: expect.any(Number),
    }))
  })

  it('执行错误时向 tool_failed 日志 payload 写入 durationMs', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const taskLogger = { filePath: '/tmp/task.jsonl', write: vi.fn(), close: vi.fn() }
    const tool = createReadTool({
      execute: async () => ({ ok: false, result: 'fail', diagnostics: { stderr: 'fail', exitCode: 1 } }),
    })
    const registry = new ToolRegistry([tool])
    const task = createTask()

    await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'secret.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger, taskLogger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(taskLogger.write).toHaveBeenCalledWith('tool_failed', expect.objectContaining({
      durationMs: expect.any(Number),
    }))
  })

  it('校验错误时向 tool_failed 日志 payload 写入 durationMs', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const taskLogger = { filePath: '/tmp/task.jsonl', write: vi.fn(), close: vi.fn() }
    const tool = createReadTool({ validateInput: () => 'Path must be absolute' })
    const registry = new ToolRegistry([tool])
    const task = createTask()

    await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: '' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger, taskLogger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(taskLogger.write).toHaveBeenCalledWith('tool_failed', expect.objectContaining({
      durationMs: expect.any(Number),
    }))
  })

  it('策略阻断时向 tool_blocked 日志 payload 写入 durationMs', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const taskLogger = { filePath: '/tmp/task.jsonl', write: vi.fn(), close: vi.fn() }
    const registry = new ToolRegistry([createReadTool()])
    const task = createTask()

    await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: '' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger, taskLogger },
      beforeToolExecute: async () => ({
        outcome: 'block',
        errorCode: 'AGENT_POLICY_BLOCKED',
        reason: 'blocked',
      }),
    })

    expect(taskLogger.write).toHaveBeenCalledWith('tool_blocked', expect.objectContaining({
      durationMs: expect.any(Number),
    }))
  })

  it('中止时向 tool_cancelled 日志 payload 写入 durationMs', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const taskLogger = { filePath: '/tmp/task.jsonl', write: vi.fn(), close: vi.fn() }
    const registry = new ToolRegistry([createReadTool()])
    const task = createTask()
    const abortController = new AbortController()
    abortController.abort()

    await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger, taskLogger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
      abortSignal: abortController.signal,
    })

    expect(taskLogger.write).toHaveBeenCalledWith('tool_cancelled', expect.objectContaining({
      durationMs: expect.any(Number),
    }))
  })

  it('工具结果自带 durationMs 时写入 toolReportedDurationMs', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const taskLogger = { filePath: '/tmp/task.jsonl', write: vi.fn(), close: vi.fn() }
    const tool = createReadTool({
      execute: async () => ({ ok: true, result: 'ok', diagnostics: { exitCode: 0, durationMs: 42 } }),
    })
    const registry = new ToolRegistry([tool])
    const task = createTask()

    await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger, taskLogger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(taskLogger.write).toHaveBeenCalledWith('tool_completed', expect.objectContaining({
      durationMs: expect.any(Number),
      toolReportedDurationMs: 42,
    }))
    expect(logger.info).not.toHaveBeenCalled()
  })
})

describe('createInvalidToolArgsResult 行为', () => {
  it('为无效工具参数创建错误结果', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const result = await createInvalidToolArgsResult({
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

  it('无效参数时保留模型提供的 tool call id', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const currentToolMessages: McpToolCall[] = []

    const result = await createInvalidToolArgsResult({
      config: { eventEmitter: emitter, logger },
      conversationId: 'conv-1',
      requestedToolCall: {
        id: 'bad-call-1',
        toolName: 'bash',
        input: {},
        invalidArgsError: 'command is required',
      },
      currentModelText: '',
      currentToolMessages,
    })

    expect(result.toolCallId).toBe('bad-call-1')
    expect(currentToolMessages).toEqual([
      expect.objectContaining({ id: 'bad-call-1', toolName: 'bash' }),
    ])
  })

  it('未提供 invalidArgsError 时使用默认错误', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const result = await createInvalidToolArgsResult({
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
