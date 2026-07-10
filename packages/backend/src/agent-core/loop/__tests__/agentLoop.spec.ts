import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAgentLoop } from '../agentLoop'
import { TaskStore } from '../../taskStore'
import { ToolRegistry } from '../../tools/toolRegistry'
import type { AgentTool, IAgentEventEmitter, IAIProvider, IAIStreamChunk, ILogger } from '@ant-chat/shared'
import type { RuntimeStartInput } from '../../session/types'

// ============================================================
// Mock AI Provider — deterministic stream control via queueMicrotask
// ============================================================
function createMockAIProvider(responses: IAIStreamChunk[][]): IAIProvider {
  let callIndex = 0
  return {
    async* streamModel(opts) {
      const chunks = responses[callIndex] ?? []
      callIndex++
      for (const chunk of chunks) {
        if (opts.abortSignal?.aborted)
          break
        yield chunk
      }
    },
    complete: vi.fn().mockResolvedValue({ text: 'mock complete' }),
  }
}

// ============================================================
// Helpers
// ============================================================
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
    execute: async () => ({ ok: true, result: 'file contents here', diagnostics: { exitCode: 0 } }),
    ...overrides,
  }
}

function createTask(taskId = 'task-loop-1', conversationId = 'conv-loop-1') {
  return {
    snapshot: {
      taskId,
      conversationId,
      userMessageId: 'msg-1',
      workspacePath: '/workspace',
      mode: 'hybrid' as const,
      status: 'running' as const,
      executionPhase: 'waiting_model' as const,
      prompt: 'test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logPath: '',
    },
    abortController: new AbortController(),
  }
}

function createBaseInput(overrides: Partial<RuntimeStartInput> & { taskId?: string, convId?: string } = {}): { taskId: string, options: RuntimeStartInput } {
  const taskId = overrides.taskId ?? 'task-loop-1'
  const { taskId: _tid, convId: _cid, ...rest } = overrides
  return {
    taskId,
    options: {
      conversationId: rest.conversationId ?? 'conv-loop-1',
      userMessageId: 'msg-1',
      workspacePath: '/workspace',
      mode: 'hybrid',
      prompt: 'test',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
      systemPrompt: 'You are helpful.',
      registry: new ToolRegistry([]),
      aiProvider: null,
      modelName: 'test-model',
      providerName: 'test-provider',
      providerId: 'provider-1',
      apiMode: 'openai',
      ...rest,
    },
  }
}

function makeTextChunk(text: string): IAIStreamChunk {
  return { content: [{ type: 'text', text }] }
}

function makeToolCallChunk(toolName: string, args: Record<string, unknown>, id?: string): IAIStreamChunk {
  return { functionCalls: [id ? { id, toolName, args } : { toolName, args }] }
}

// ============================================================
// Tests
// ============================================================
describe('runAgentLoop 行为', () => {
  let emitter: IAgentEventEmitter
  let logger: ILogger
  let taskStore: TaskStore

  beforeEach(() => {
    emitter = createMockEmitter()
    logger = createMockLogger()
    taskStore = new TaskStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('模型只返回文本且没有工具调用时以最终答案完成', async () => {
    const aiProvider = createMockAIProvider([
      [makeTextChunk('Hello'), makeTextChunk(' World')],
    ])

    const { taskId, options } = createBaseInput({
      aiProvider: aiProvider as unknown as IAIProvider,
    })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    await runAgentLoop({
      task: taskStore.get(taskId)!,
      finishTask: () => taskStore.finish(taskId),
      dequeueSteeringInputs: () => taskStore.dequeueSteeringInputs(taskId),
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    const updated = taskStore.get(taskId)
    // task is finished (removed from store) on success
    expect(updated).toBeUndefined()

    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        text: 'Hello World',
        durationMs: expect.any(Number),
      }),
    )
  })

  it('向 task log 写入模型请求诊断信息', async () => {
    const aiProvider = createMockAIProvider([
      [makeTextChunk('Done')],
    ])
    const taskLogger = {
      filePath: '/tmp/task.jsonl',
      write: vi.fn(),
      close: vi.fn(),
    }
    const readTool = createReadTool()

    const { taskId, options } = createBaseInput({
      aiProvider: aiProvider as unknown as IAIProvider,
      registry: new ToolRegistry([readTool]),
      systemPrompt: [
        'You are helpful.',
        'Use persistent memory for durable user preferences.',
      ].join('\n'),
      taskLogger,
    })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    await runAgentLoop({
      task: taskStore.get(taskId)!,
      finishTask: () => taskStore.finish(taskId),
      dequeueSteeringInputs: () => taskStore.dequeueSteeringInputs(taskId),
      options,
      config: { eventEmitter: emitter, logger, taskLogger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(taskLogger.write).toHaveBeenCalledWith('model_request_started', expect.objectContaining({
      runId: taskId,
      taskId,
      conversationId: options.conversationId,
      userMessageId: options.userMessageId,
      messagesPreviewKind: 'full',
      contextResetReason: 'initial',
      model: options.modelName,
      provider: options.providerName,
      toolNames: ['read_file'],
      systemPromptPreview: expect.stringContaining('durable user preferences'),
      messagesPreview: [
        expect.objectContaining({
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        }),
      ],
    }))
    expect(taskLogger.write).toHaveBeenCalledWith('model_response_finished', expect.objectContaining({
      runId: taskId,
      taskId,
      durationMs: expect.any(Number),
      textPreview: 'Done',
      hasToolCall: false,
      toolCalls: [],
    }))
    expect(taskLogger.close).toHaveBeenCalledTimes(1)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('首次模型请求后只写入新增消息', async () => {
    const taskLogger = {
      filePath: '/tmp/task.jsonl',
      write: vi.fn(),
      close: vi.fn(),
    }
    const readTool = createReadTool()
    const aiProvider = createMockAIProvider([
      [makeToolCallChunk('read_file', { path: 'test.txt' }, 'tool-call-1')],
      [makeTextChunk('File contents: file contents here')],
    ])

    const { taskId, options } = createBaseInput({
      aiProvider: aiProvider as unknown as IAIProvider,
      registry: new ToolRegistry([readTool]),
      taskLogger,
    })
    taskStore.create(createTask(taskId, options.conversationId))

    await runAgentLoop({
      task: taskStore.get(taskId)!,
      finishTask: () => taskStore.finish(taskId),
      dequeueSteeringInputs: () => taskStore.dequeueSteeringInputs(taskId),
      options,
      config: { eventEmitter: emitter, logger, taskLogger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    const requestPayloads = taskLogger.write.mock.calls
      .filter(([event]) => event === 'model_request_started')
      .map(([, payload]) => payload as Record<string, any>)

    expect(requestPayloads).toHaveLength(2)
    expect(requestPayloads[0]).toEqual(expect.objectContaining({
      messagesPreviewKind: 'full',
      messagesPreviewStartIndex: 0,
      messagesPreviewCount: 1,
      contextResetReason: 'initial',
    }))
    expect(requestPayloads[1]).toEqual(expect.objectContaining({
      messagesPreviewKind: 'delta',
      messagesPreviewStartIndex: 1,
      messagesPreviewCount: 2,
      contextResetReason: undefined,
    }))
    expect(requestPayloads[1].messagesPreview).toEqual([
      expect.objectContaining({ role: 'assistant' }),
      expect.objectContaining({ role: 'tool' }),
    ])
  })

  it('aiProvider 为 null 时抛错', async () => {
    const { taskId, options } = createBaseInput({ aiProvider: null })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    await runAgentLoop({
      task: taskStore.get(taskId)!,
      finishTask: () => taskStore.finish(taskId),
      dequeueSteeringInputs: () => taskStore.dequeueSteeringInputs(taskId),
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', durationMs: expect.any(Number) }),
    )
  })

  it('通过 createInvalidToolArgsResult 处理无效工具参数', async () => {
    const aiProvider = createMockAIProvider([
      // Tool call with missing required arg — args will be empty
      [makeToolCallChunk('read_file', {})],
      // Second turn: model corrects
      [makeTextChunk('Let me try with correct path')],
      [makeToolCallChunk('read_file', { path: 'real.txt' })],
      [makeTextChunk('Done')],
    ])

    // Validate that path is required
    const readTool = createReadTool({
      validateInput: (input) => {
        if (!input.path || typeof input.path !== 'string')
          return 'path is required'
        return null
      },
    })

    const { taskId, options } = createBaseInput({
      aiProvider: aiProvider as unknown as IAIProvider,
      registry: new ToolRegistry([readTool]),
    })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    await runAgentLoop({
      task: taskStore.get(taskId)!,
      finishTask: () => taskStore.finish(taskId),
      dequeueSteeringInputs: () => taskStore.dequeueSteeringInputs(taskId),
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', durationMs: expect.any(Number) }),
    )
  })
})
