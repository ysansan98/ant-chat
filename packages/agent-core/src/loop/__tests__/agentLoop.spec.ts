import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAgentLoop } from '../agentLoop'
import { taskStore } from '../../taskStore'
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
    execute: async () => ({ ok: true, output: 'file contents here', exitCode: 0 }),
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
      prompt: 'test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logPath: '',
    },
    abortController: new AbortController(),
    steeringQueue: [],
    pendingResolver: undefined as ((v: { approved: boolean, reason?: string }) => void) | undefined,
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
describe('runAgentLoop', () => {
  let emitter: IAgentEventEmitter
  let logger: ILogger

  beforeEach(() => {
    emitter = createMockEmitter()
    logger = createMockLogger()
  })

  afterEach(() => {
    // Clean up taskStore
    for (const t of taskStore.listActive()) {
      try {
        taskStore.finish(t.taskId)
      }
      catch {}
      try {
        taskStore.delete(t.taskId)
      }
      catch {}
    }
    vi.restoreAllMocks()
  })

  it('completes with final answer when model returns text without tool calls', async () => {
    const aiProvider = createMockAIProvider([
      [makeTextChunk('Hello'), makeTextChunk(' World')],
    ])

    const { taskId, options } = createBaseInput({
      aiProvider: aiProvider as unknown as IAIProvider,
    })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    await runAgentLoop({
      taskId,
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

  it('writes model request diagnostics to the task log', async () => {
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
      taskId,
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

  it('writes only new messages after the first model request', async () => {
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
      taskId,
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

  it('writes a full model request snapshot after compaction', async () => {
    const taskLogger = {
      filePath: '/tmp/task.jsonl',
      write: vi.fn(),
      close: vi.fn(),
    }
    const readTool = createReadTool()
    const aiProvider = createMockAIProvider([
      [makeToolCallChunk('read_file', { path: 'test.txt' }, 'tool-call-1')],
      [makeTextChunk('Done after compaction')],
    ])
    let beforeTurnCount = 0
    const onBeforeTurn = vi.fn(async (ctx: { messages: RuntimeStartInput['messages'], step: number }) => {
      beforeTurnCount++
      if (beforeTurnCount === 1) {
        return { messages: ctx.messages, compacted: false }
      }
      return {
        messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'after compaction' }] }],
        compacted: true,
      }
    })

    const { taskId, options } = createBaseInput({
      aiProvider: aiProvider as unknown as IAIProvider,
      registry: new ToolRegistry([readTool]),
      taskLogger,
    })
    taskStore.create(createTask(taskId, options.conversationId))

    await runAgentLoop({
      taskId,
      options,
      config: { eventEmitter: emitter, logger, taskLogger },
      onBeforeTurn,
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    const requestPayloads = taskLogger.write.mock.calls
      .filter(([event]) => event === 'model_request_started')
      .map(([, payload]) => payload as Record<string, any>)

    expect(requestPayloads).toHaveLength(2)
    expect(requestPayloads[1]).toEqual(expect.objectContaining({
      messagesPreviewKind: 'full',
      messagesPreviewStartIndex: 0,
      messagesPreviewCount: 1,
      contextResetReason: 'compaction',
    }))
    expect(requestPayloads[1].messagesPreview).toEqual([
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'after compaction' }],
      }),
    ])
  })

  it('executes tool calls and continues conversation', async () => {
    const readTool = createReadTool()
    const aiProvider = createMockAIProvider([
      // First turn: request tool
      [makeToolCallChunk('read_file', { path: 'test.txt' })],
      // Second turn: final answer after tool result
      [makeTextChunk('File contents: file contents here')],
    ])

    const { taskId, options } = createBaseInput({
      aiProvider: aiProvider as unknown as IAIProvider,
      registry: new ToolRegistry([readTool]),
    })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    await runAgentLoop({
      taskId,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    // Task should be finished (completed)
    expect(taskStore.get(taskId)).toBeUndefined()

    // Should have emitted tool calls
    expect(emitter.emitTurnToolCalls).toHaveBeenCalled()

    // Should have finished successfully
    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', durationMs: expect.any(Number) }),
    )
  })

  it('keeps duplicate tool calls from the same model response', async () => {
    const execute = vi.fn(async (input: Record<string, unknown>) => ({ ok: true, output: `contents:${input.path}`, exitCode: 0 }))
    const readTool = createReadTool({ execute })
    const modelRequests: RuntimeStartInput['messages'][] = []
    const aiProvider: IAIProvider = {
      async* streamModel(opts) {
        modelRequests.push(opts.messages)
        if (modelRequests.length === 1) {
          yield {
            functionCalls: [
              { id: 'call-a', toolName: 'read_file', args: { path: 'a.txt' } },
              { id: 'call-b', toolName: 'read_file', args: { path: 'b.txt' } },
            ],
          }
          return
        }
        yield makeTextChunk('Done')
      },
      complete: vi.fn().mockResolvedValue({ text: 'mock complete' }),
    }

    const { taskId, options } = createBaseInput({
      aiProvider,
      registry: new ToolRegistry([readTool]),
    })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    await runAgentLoop({
      taskId,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenNthCalledWith(1, { path: 'a.txt' })
    expect(execute).toHaveBeenNthCalledWith(2, { path: 'b.txt' })

    const secondRequestMessages = modelRequests[1]
    const assistantMessage = secondRequestMessages.find(message => message.role === 'assistant')
    const toolMessages = secondRequestMessages.filter(message => message.role === 'tool')
    expect(assistantMessage?.content.filter(item => item.type === 'tool-call')).toEqual([
      expect.objectContaining({ toolCallId: 'call-a', toolName: 'read_file', args: { path: 'a.txt' } }),
      expect.objectContaining({ toolCallId: 'call-b', toolName: 'read_file', args: { path: 'b.txt' } }),
    ])
    expect(toolMessages).toHaveLength(2)
    expect(toolMessages[0]?.content).toEqual([
      expect.objectContaining({ toolCallId: 'call-a', toolName: 'read_file', isError: false }),
    ])
    expect(toolMessages[1]?.content).toEqual([
      expect.objectContaining({ toolCallId: 'call-b', toolName: 'read_file', isError: false }),
    ])
  })

  it('aborts when abortController is signaled during tool execution', async () => {
    const { taskId, options } = createBaseInput()
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    // Tool that can be aborted during execution
    const slowTool = createReadTool({
      execute: async () => {
        // Abort fires while tool is "executing"
        task.abortController.abort()
        // Then return success (the abort check in agentLoop happens after tool execution)
        return { ok: true, output: 'result', exitCode: 0 }
      },
    })

    const aiProvider = createMockAIProvider([
      // First turn: request tool call
      [makeToolCallChunk('read_file', { path: 'test.txt' })],
      // Second turn (won't be reached due to abort check)
    ])
    options.aiProvider = aiProvider as unknown as IAIProvider
    options.registry = new ToolRegistry([slowTool])

    await runAgentLoop({
      taskId,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    const updated = taskStore.get(taskId)
    expect(updated).toBeUndefined()

    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancel', durationMs: expect.any(Number) }),
    )
  })

  it('calls onBeforeTurn hook before each model call', async () => {
    const aiProvider = createMockAIProvider([
      [makeTextChunk('Answer')],
    ])

    const { taskId, options } = createBaseInput({
      aiProvider: aiProvider as unknown as IAIProvider,
    })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    const onBeforeTurn = vi.fn().mockResolvedValue({ messages: options.messages })

    await runAgentLoop({
      taskId,
      options,
      config: { eventEmitter: emitter, logger },
      onBeforeTurn,
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(onBeforeTurn).toHaveBeenCalledTimes(1)
    expect(onBeforeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        step: 1,
        messages: expect.any(Array),
      }),
    )
  })
  it('uses system prompt returned by onBeforeTurn for the model call', async () => {
    const prompts: string[] = []
    const aiProvider: IAIProvider = {
      async* streamModel(opts) {
        prompts.push(opts.modelSettings.systemPrompt)
        yield makeTextChunk('Answer')
      },
      complete: vi.fn().mockResolvedValue({ text: 'mock complete' }),
    }

    const { taskId, options } = createBaseInput({
      aiProvider,
      systemPrompt: 'Initial prompt.',
    })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    await runAgentLoop({
      taskId,
      options,
      config: { eventEmitter: emitter, logger },
      onBeforeTurn: async () => ({ messages: options.messages, systemPrompt: 'Refreshed prompt.' }),
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(prompts).toEqual(['Refreshed prompt.'])
  })

  it('throws when aiProvider is null', async () => {
    const { taskId, options } = createBaseInput({ aiProvider: null })
    const task = createTask(taskId, options.conversationId)
    taskStore.create(task)

    await runAgentLoop({
      taskId,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', durationMs: expect.any(Number) }),
    )
  })

  it('throws when task does not exist', async () => {
    await expect(
      runAgentLoop({
        taskId: 'nonexistent',
        options: createBaseInput().options,
        config: { eventEmitter: emitter, logger },
        beforeToolExecute: async () => ({ outcome: 'allow' }),
      }),
    ).rejects.toThrow('Task not found')
  })

  it('handles tool with invalid args via createInvalidToolArgsResult', async () => {
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
      taskId,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', durationMs: expect.any(Number) }),
    )
  })
})
