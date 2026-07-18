import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAgentLoop } from '../agentLoop'
import { ToolRegistry } from '../../tools/toolRegistry'
import { createPublishVisualizationTool } from '../../tools/publishVisualizationTool'
import type { AgentRuntimeConfig, AgentTool, IAgentEventEmitter, IAIProvider, IAIStreamChunk, ILogger, LoopMessage } from '@ant-chat/shared'
import type { RuntimeStartInput } from '../../session/types'
import type { RuntimeTask, TaskExecution } from '../../taskStore'

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
    },
    abortController: new AbortController(),
  }
}

function createExecution(task: RuntimeTask): { execution: TaskExecution, finish: ReturnType<typeof vi.fn> } {
  const finish = vi.fn()
  return {
    execution: {
      task,
      dequeueSteeringInputs: () => [],
      finish,
    },
    finish,
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
      userText: 'test',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
      registry: new ToolRegistry([]),
      systemPrompt: '',
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
  beforeEach(() => {
    emitter = createMockEmitter()
    logger = createMockLogger()
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
    const { execution, finish } = createExecution(task)

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(finish).toHaveBeenCalledTimes(1)

    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        text: 'Hello World',
        durationMs: expect.any(Number),
      }),
    )
  })

  it('清理 turn secrets 失败时仍释放 task', async () => {
    const aiProvider = createMockAIProvider([[makeTextChunk('Done')]])
    const { taskId, options } = createBaseInput({ aiProvider: aiProvider as IAIProvider })
    const { execution, finish } = createExecution(createTask(taskId, options.conversationId))
    const secretStore: NonNullable<AgentRuntimeConfig['secretStore']> = {
      saveProviderApiKey: vi.fn(async () => { throw new Error('unused') }),
      getProviderApiKey: vi.fn(async () => null),
      deleteProviderApiKey: vi.fn(async () => {}),
      createTurnSecret: vi.fn(async () => { throw new Error('unused') }),
      resolve: vi.fn(async () => null),
      clearTurnSecrets: vi.fn().mockRejectedValue(new Error('secret cleanup failed')),
    }

    await expect(runAgentLoop({
      execution,
      options,
      config: {
        eventEmitter: emitter,
        logger,
        secretStore,
      },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })).rejects.toThrow('secret cleanup failed')

    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('记录与 streamModel 入参相同的完整模型请求', async () => {
    const aiProvider = createMockAIProvider([
      [makeTextChunk('Done')],
    ])
    const readTool = createReadTool()
    const streamModel = vi.spyOn(aiProvider, 'streamModel')
    const span = { id: 'mock', complete: vi.fn<(output?: unknown) => void>(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn<(input: unknown) => typeof span>(() => span),
      startToolCall: vi.fn(() => span),
      startPolicyDecision: vi.fn(() => span),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }

    const { taskId, options } = createBaseInput({
      aiProvider: aiProvider as unknown as IAIProvider,
      registry: new ToolRegistry([readTool]),
      systemPrompt: [
        'You are helpful.',
        'Use persistent memory for durable user preferences.',
      ].join('\n'),
    })
    const task = createTask(taskId, options.conversationId)
    const { execution } = createExecution(task)

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger, turnRecorder },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(turnRecorder.startModelRequest).toHaveBeenCalledTimes(1)
    expect(turnRecorder.startModelRequest.mock.calls[0][0]).toBe(streamModel.mock.calls[0][0])
    expect(span.complete).toHaveBeenCalledWith(expect.objectContaining({ text: 'Done', toolCalls: [] }))
    expect(turnRecorder.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }))
  })

  it('publish_visualization 在后续模型上下文保留原始 HTML', async () => {
    const html = '<section class="card"><button type="button">更新趋势</button></section>'
    const input = { title: '趋势', summary: '展示趋势', html }
    const modelRequests: LoopMessage[][] = []
    let requestIndex = 0
    const aiProvider: IAIProvider = {
      async* streamModel(options) {
        modelRequests.push(options.messages)
        const chunks = requestIndex++ === 0
          ? [makeToolCallChunk('publish_visualization', input, 'visualization-1')]
          : [makeTextChunk('已生成趋势图')]
        yield* chunks
      },
      complete: vi.fn().mockResolvedValue({ text: 'mock complete' }),
    }
    const { taskId, options } = createBaseInput({
      aiProvider,
      registry: new ToolRegistry([createPublishVisualizationTool()]),
    })
    const { execution } = createExecution(createTask(taskId, options.conversationId))

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(modelRequests[1]).toContainEqual(expect.objectContaining({
      role: 'assistant',
      content: [expect.objectContaining({ type: 'tool-call', toolName: 'publish_visualization', args: input })],
    }))
  })

  it('aiProvider 为 null 时抛错', async () => {
    const { taskId, options } = createBaseInput({ aiProvider: null })
    const task = createTask(taskId, options.conversationId)
    const { execution } = createExecution(task)

    await runAgentLoop({
      execution,
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
    const { execution } = createExecution(task)

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', durationMs: expect.any(Number) }),
    )
  })

  it('非法 JSON 工具参数的 Tool span 继承当前 Model span', async () => {
    const aiProvider = createMockAIProvider([
      [{ functionCalls: [{ id: 'bad-call', toolName: 'read_file', args: '{bad json' }] } as unknown as IAIStreamChunk],
      [makeTextChunk('已修正')],
    ])
    const modelSpan = { id: 'model-span-1', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const toolSpan = { id: 'tool-span-1', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const startToolCall = vi.fn(() => toolSpan)
    const turnRecorder = {
      startModelRequest: vi.fn(() => modelSpan),
      startToolCall,
      startPolicyDecision: vi.fn(() => toolSpan),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }
    const { taskId, options } = createBaseInput({
      aiProvider,
      registry: new ToolRegistry([createReadTool()]),
    })
    const { execution } = createExecution(createTask(taskId, options.conversationId))

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger, turnRecorder },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(startToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'bad-call',
      toolName: 'read_file',
    }), 'model-span-1')
  })
})
