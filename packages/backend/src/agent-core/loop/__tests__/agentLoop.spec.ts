import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAgentLoop } from '../agentLoop'
import { AgentError } from '../../AgentError'
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
      saveMcpOAuthCredential: vi.fn(async () => {}),
      getMcpOAuthCredential: vi.fn(async () => null),
      deleteMcpOAuthCredential: vi.fn(async () => {}),
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

  it('模型请求抛错时标记 Model span 和 Turn 为失败', async () => {
    const providerError = new Error('provider unavailable')
    const aiProvider: IAIProvider = {
      async* streamModel() {
        throw providerError
      },
      complete: vi.fn().mockResolvedValue({ text: 'unused' }),
    }
    const modelSpan = { id: 'model-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn(() => modelSpan),
      startToolCall: vi.fn(() => modelSpan),
      startPolicyDecision: vi.fn(() => modelSpan),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }
    const { taskId, options } = createBaseInput({ aiProvider })
    const task = createTask(taskId, options.conversationId)
    const { execution } = createExecution(task)

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger, turnRecorder },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(modelSpan.fail).toHaveBeenCalledWith(providerError)
    expect(modelSpan.cancel).not.toHaveBeenCalled()
    expect(task.snapshot.status).toBe('failed')
    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
    expect(turnRecorder.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('模型流因任务 signal 中止时标记 Model span 和 Turn 为取消', async () => {
    const modelSpan = { id: 'model-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn(() => modelSpan),
      startToolCall: vi.fn(() => modelSpan),
      startPolicyDecision: vi.fn(() => modelSpan),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }
    const { taskId, options } = createBaseInput()
    const task = createTask(taskId, options.conversationId)
    options.aiProvider = {
      async* streamModel() {
        task.abortController.abort()
        throw new DOMException('The operation was aborted', 'AbortError')
      },
      complete: vi.fn().mockResolvedValue({ text: 'unused' }),
    }
    const { execution } = createExecution(task)

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger, turnRecorder },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(modelSpan.cancel).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }))
    expect(modelSpan.fail).not.toHaveBeenCalled()
    expect(task.snapshot.status).toBe('cancelled')
    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancel' }))
    expect(turnRecorder.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('provider 返回取消错误时统一取消 Model span 和 Turn', async () => {
    const cancellation = new AgentError('AGENT_CANCELLED', '任务已取消')
    const aiProvider: IAIProvider = {
      async* streamModel() {
        throw cancellation
      },
      complete: vi.fn().mockResolvedValue({ text: 'unused' }),
    }
    const modelSpan = { id: 'model-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn(() => modelSpan),
      startToolCall: vi.fn(() => modelSpan),
      startPolicyDecision: vi.fn(() => modelSpan),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }
    const { taskId, options } = createBaseInput({ aiProvider })
    const task = createTask(taskId, options.conversationId)
    const { execution } = createExecution(task)

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger, turnRecorder },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(modelSpan.cancel).toHaveBeenCalledWith(cancellation)
    expect(modelSpan.fail).not.toHaveBeenCalled()
    expect(task.snapshot.status).toBe('cancelled')
    expect(turnRecorder.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('模型流在 signal 中止后正常返回也标记 Model span 和 Turn 为取消', async () => {
    const modelSpan = { id: 'model-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn(() => modelSpan),
      startToolCall: vi.fn(() => modelSpan),
      startPolicyDecision: vi.fn(() => modelSpan),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }
    const { taskId, options } = createBaseInput()
    const task = createTask(taskId, options.conversationId)
    options.aiProvider = {
      async* streamModel() {
        task.abortController.abort()
      },
      complete: vi.fn().mockResolvedValue({ text: 'unused' }),
    }
    const { execution } = createExecution(task)

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger, turnRecorder },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(modelSpan.cancel).toHaveBeenCalledWith('任务已取消')
    expect(modelSpan.complete).not.toHaveBeenCalled()
    expect(task.snapshot.status).toBe('cancelled')
    expect(turnRecorder.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('工具执行期间任务中止时取消 Tool span 和 Turn', async () => {
    const modelSpan = { id: 'model-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const toolSpan = { id: 'tool-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn(() => modelSpan),
      startToolCall: vi.fn(() => toolSpan),
      startPolicyDecision: vi.fn(() => toolSpan),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }
    const { taskId, options } = createBaseInput()
    const task = createTask(taskId, options.conversationId)
    options.aiProvider = createMockAIProvider([[
      makeToolCallChunk('read_file', { path: 'test.txt' }, 'tool-call-1'),
    ]])
    options.registry = new ToolRegistry([createReadTool({
      execute: async () => {
        task.abortController.abort()
        throw new DOMException('The operation was aborted', 'AbortError')
      },
    })])
    const { execution } = createExecution(task)

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger, turnRecorder },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(modelSpan.complete).toHaveBeenCalled()
    expect(toolSpan.cancel).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }))
    expect(toolSpan.fail).not.toHaveBeenCalled()
    expect(task.snapshot.status).toBe('cancelled')
    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancel' }))
    expect(turnRecorder.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
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

  it('普通交互的工具调用被策略阻断后仍把结果交回模型继续', async () => {
    const modelRequests: LoopMessage[][] = []
    let requestIndex = 0
    const aiProvider: IAIProvider = {
      async* streamModel(options) {
        modelRequests.push(options.messages)
        yield* requestIndex++ === 0
          ? [makeToolCallChunk('read_file', { path: 'test.txt' }, 'blocked-call')]
          : [makeTextChunk('已调整执行方案')]
      },
      complete: vi.fn().mockResolvedValue({ text: 'unused' }),
    }
    const { taskId, options } = createBaseInput({
      aiProvider,
      registry: new ToolRegistry([createReadTool()]),
    })
    const task = createTask(taskId, options.conversationId)
    const { execution } = createExecution(task)

    await runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitter, logger },
      beforeToolExecute: async () => ({
        outcome: 'block',
        errorCode: 'AGENT_POLICY_BLOCKED',
        reason: '策略阻断，禁止执行',
      }),
    })

    expect(modelRequests).toHaveLength(2)
    expect(modelRequests[1]).toContainEqual({
      role: 'tool',
      content: [expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'blocked-call',
        isError: true,
      })],
    })
    expect(task.snapshot.status).toBe('success')
    expect(emitter.emitTurnFinished).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      text: '已调整执行方案',
    }))
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

  it('命令工具执行中取消时补写 tool-result 并立即终止 turn', async () => {
    let markExecuteStarted: () => void
    const executeStarted = new Promise<void>((resolve) => {
      markExecuteStarted = resolve
    })
    // 模拟 runPreparedCommand：仅在取消信号触发时结束
    const hangingCommandTool = {
      name: 'execute_command',
      source: 'native',
      description: 'Runs a command',
      inputSchema: {
        type: 'object' as const,
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
      operationType: 'command' as const,
      inferScope: () => 'workspace' as const,
      execute: async () => ({ ok: false, result: 'unused' }),
      prepare: () => ({
        scope: 'workspace' as const,
        operationType: 'command' as const,
        state: {},
        execute: (_input: Record<string, unknown>, abortSignal?: AbortSignal) => new Promise((resolve) => {
          markExecuteStarted()
          if (abortSignal?.aborted)
            resolve({ ok: false, result: '任务已取消。' })
          else
            abortSignal?.addEventListener('abort', () => resolve({ ok: false, result: '任务已取消。' }), { once: true })
        }),
      }),
    }
    const aiProvider: IAIProvider = {
      async* streamModel() {
        yield makeToolCallChunk('execute_command', { command: 'sleep 3600' }, 'cmd-1')
      },
      complete: vi.fn().mockResolvedValue({ text: 'mock' }),
    }
    const { taskId, options } = createBaseInput({
      aiProvider,
      registry: new ToolRegistry([hangingCommandTool as unknown as AgentTool]),
    })
    const task = createTask(taskId, options.conversationId)
    const { execution, finish } = createExecution(task)
    const emitterWithToolResults = {
      ...emitter,
      emitTurnToolResults: vi.fn(),
    }

    const loop = runAgentLoop({
      execution,
      options,
      config: { eventEmitter: emitterWithToolResults, logger },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    await executeStarted
    task.abortController.abort()
    await loop

    expect(task.snapshot.status).toBe('cancelled')
    expect(finish).toHaveBeenCalledTimes(1)
    expect(emitterWithToolResults.emitTurnFinished).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancel' }))
    // 取消必须落 tool-call 终态和 cancelled tool-result，不能停留在 executing
    const toolCalls = vi.mocked(emitterWithToolResults.emitTurnToolCalls).mock.calls.at(-1)?.[0] as {
      toolCalls: Array<{ executeState?: string }>
    }
    expect(toolCalls?.toolCalls[0]).toMatchObject({ executeState: 'completed' })
    expect(emitterWithToolResults.emitTurnToolResults).toHaveBeenCalledWith(expect.objectContaining({
      results: [
        expect.objectContaining({
          type: 'tool-result',
          toolCallId: 'cmd-1',
          result: '任务已取消。',
          isError: true,
        }),
      ],
    }))
  })
})
