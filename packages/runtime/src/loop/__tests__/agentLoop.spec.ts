import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAgentLoop } from '../agentLoop'
import { taskStore } from '../taskStore'
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
      tools: [],
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

function makeToolCallChunk(toolName: string, args: Record<string, unknown>): IAIStreamChunk {
  return { functionCalls: [{ toolName, args }] }
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
      }),
    )
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
      tools: [readTool],
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
      expect.objectContaining({ status: 'success' }),
    )
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
    options.tools = [slowTool]

    await runAgentLoop({
      taskId,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    const updated = taskStore.get(taskId)
    expect(updated).toBeUndefined()

    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancel' }),
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
      expect.objectContaining({ status: 'error' }),
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
      tools: [readTool],
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
      expect.objectContaining({ status: 'success' }),
    )
  })
})
