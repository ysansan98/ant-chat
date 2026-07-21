import { describe, expect, it, vi } from 'vitest'
import { createPublishVisualizationTool } from '../publishVisualizationTool'
import { createInvalidToolArgsResult, executeToolStep } from '../toolExecution'
import { ToolRegistry } from '../toolRegistry'
import type { AgentRuntimeConfig, AgentTaskSnapshot, AgentTool, IAgentEventEmitter, ILogger, McpToolCall } from '@ant-chat/shared'

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
      ...overrides,
    } as AgentTaskSnapshot,
    abortController: new AbortController(),
  }
}

function createMockSecretStore(secret: string): NonNullable<AgentRuntimeConfig['secretStore']> {
  return {
    saveProviderApiKey: vi.fn(async () => ({ kind: 'secret_ref' as const, id: 'unused', scope: 'persistent' as const })),
    getProviderApiKey: vi.fn(async () => null),
    deleteProviderApiKey: vi.fn(async () => {}),
    createTurnSecret: vi.fn(async () => ({ kind: 'secret_ref' as const, id: 'unused', scope: 'turn' as const })),
    resolve: vi.fn(async () => secret),
    clearTurnSecrets: vi.fn(async () => {}),
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
    const span = { id: 'validation-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn(() => span),
      startToolCall: vi.fn(() => span),
      startPolicyDecision: vi.fn(() => span),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }

    const result = await executeToolStep({
      task,
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: '' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: emitter, logger, turnRecorder },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toContain('Path must be absolute')
    expect(turnRecorder.startToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'read_file',
      input: { path: '' },
    }), undefined)
    expect(span.fail).toHaveBeenCalledWith(expect.objectContaining({ error: 'Path must be absolute' }))
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

  it('自动化被权限策略阻断时终止执行而不是把错误交回模型继续', async () => {
    const currentToolMessages: McpToolCall[] = []
    const task = createTask({
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: [],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: false,
          allowBrowser: false,
          allowMcpTools: false,
          extraFileRoots: [],
          allowBashCommands: false,
          bashCommandPatterns: [],
        },
      },
    })

    await expect(executeToolStep({
      task,
      registry: new ToolRegistry([createReadTool()]),
      requestedToolCall: { toolName: 'read_file', input: {} },
      currentModelText: '',
      currentToolMessages,
      step: 1,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      beforeToolExecute: async () => ({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '任务需要额外授权' }),
    })).rejects.toMatchObject({ code: 'AGENT_POLICY_BLOCKED', message: '任务需要额外授权' })

    expect(currentToolMessages[0]).toMatchObject({
      executeState: 'completed',
      result: { success: false, error: 'AGENT_POLICY_BLOCKED' },
    })
  })

  it('策略阻断时不会提前解析 SecretRef', async () => {
    const secretStore = createMockSecretStore('不得解析')
    const result = await executeToolStep({
      task: createTask(),
      registry: new ToolRegistry([createReadTool()], undefined, secretStore),
      requestedToolCall: { toolName: 'read_file', input: { path: { kind: 'secret_ref', id: 'secret-id', scope: 'turn' } } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger(), secretStore },
      beforeToolExecute: async () => ({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '策略阻断' }),
    })

    expect(result.isError).toBe(true)
    expect(secretStore.resolve).not.toHaveBeenCalled()
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

  it('publish_visualization 执行失败时返回结构化失败 envelope', async () => {
    const tool = createReadTool({
      name: 'publish_visualization',
      execute: async () => ({ ok: false, result: 'artifact 写入失败' }),
    })
    const result = await executeToolStep({
      task: createTask(),
      registry: new ToolRegistry([tool]),
      requestedToolCall: { toolName: 'publish_visualization', input: {} },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.toolResultContent)).toEqual({ success: false, status: 'failed', message: 'artifact 写入失败' })
  })

  it('publish_visualization 校验失败时返回结构化失败 envelope', async () => {
    const result = await executeToolStep({
      task: createTask(),
      registry: new ToolRegistry([createPublishVisualizationTool()]),
      requestedToolCall: { toolName: 'publish_visualization', input: { title: 'bad', summary: '', html: '<iframe></iframe>' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.toolResultContent)).toEqual(expect.objectContaining({ success: false, status: 'failed', message: expect.stringContaining('iframe') }))
  })

  it('工具执行抛异常时返回工具失败并保留异常细节', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const span = { id: 'mock', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = { startModelRequest: vi.fn(() => span), startToolCall: vi.fn(() => span), startPolicyDecision: vi.fn(() => span), recordContextEvent: vi.fn(), finish: vi.fn() }
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
      config: { eventEmitter: emitter, logger, turnRecorder },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.isError).toBe(true)
    expect(result.toolResultContent).toBe('secret missing')
    expect(span.fail).toHaveBeenCalledWith(expect.objectContaining({
      error: 'AGENT_TOOL_EXEC_FAILED',
      diagnostics: expect.objectContaining({ stderr: 'secret missing' }),
    }))
    expect(emitter.emitTurnToolCalls).toHaveBeenCalledTimes(2)
  })

  it('工具执行期间任务中止时取消 Tool span 并向 loop 抛出取消', async () => {
    const span = { id: 'tool-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const task = createTask()
    const tool = createReadTool({
      execute: async () => {
        task.abortController.abort()
        throw new DOMException('The operation was aborted', 'AbortError')
      },
    })

    await expect(executeToolStep({
      task,
      registry: new ToolRegistry([tool]),
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: {
        eventEmitter: createMockEmitter(),
        logger: createMockLogger(),
        turnRecorder: {
          startModelRequest: vi.fn(() => span),
          startToolCall: vi.fn(() => span),
          startPolicyDecision: vi.fn(() => span),
          recordContextEvent: vi.fn(),
          finish: vi.fn(),
        },
      },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
      abortSignal: task.abortController.signal,
    })).rejects.toMatchObject({ code: 'AGENT_CANCELLED' })

    expect(span.cancel).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }))
    expect(span.fail).not.toHaveBeenCalled()
    expect(span.complete).not.toHaveBeenCalled()
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

    expect(emitter.emitTurnToolCalls).toHaveBeenCalledTimes(2)
  })

  it('策略放行后创建工具 span 并记录执行结果，阻断/取消则不创建工具 span', async () => {
    const span = { id: 'mock', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const policySpan = { id: 'policy-mock', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn(() => span),
      startToolCall: vi.fn(() => span),
      startPolicyDecision: vi.fn(() => policySpan),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }
    const config = { eventEmitter: createMockEmitter(), logger: createMockLogger(), turnRecorder }
    const registry = new ToolRegistry([createReadTool()])

    await executeToolStep({
      task: createTask(),
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config,
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })
    expect(turnRecorder.startToolCall).toHaveBeenCalledTimes(1)
    expect(span.complete).toHaveBeenCalledWith(expect.objectContaining({ output: 'file content' }))

    turnRecorder.startToolCall.mockClear()
    span.complete.mockClear()

    await executeToolStep({
      task: createTask(),
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 2,
      config,
      beforeToolExecute: async () => ({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: 'blocked' }),
    })
    expect(turnRecorder.startToolCall).not.toHaveBeenCalled()

    const abortController = new AbortController()
    abortController.abort()
    await executeToolStep({
      task: createTask(),
      registry,
      requestedToolCall: { toolName: 'read_file', input: { path: 'test.txt' } },
      currentModelText: '',
      currentToolMessages: [],
      step: 3,
      config,
      beforeToolExecute: async () => ({ outcome: 'allow' }),
      abortSignal: abortController.signal,
    })
    expect(span.cancel).not.toHaveBeenCalled()
  })

  it('工具成功回显任意格式的 SecretRef 真实值时深度脱敏运行结果和观测证据', async () => {
    const secret = 'p@$$w0rd\n[]{}.*?'
    const secretRef = { kind: 'secret_ref' as const, id: 'secret-id-1', scope: 'turn' as const }
    const span = { id: 'tool-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const secretStore = createMockSecretStore(secret)
    const tool = createReadTool({
      execute: async () => ({
        ok: true,
        result: `stdout:${secret}:secret-id-1`,
        diagnostics: {
          data: { nested: [`value=${secret}`, { ref: 'secret-id-1' }] },
          stderr: `stderr=${secret}`,
        },
      }),
    })

    const result = await executeToolStep({
      task: createTask(),
      registry: new ToolRegistry([tool], undefined, secretStore),
      requestedToolCall: { toolName: 'read_file', input: { path: secretRef } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: {
        eventEmitter: createMockEmitter(),
        logger: createMockLogger(),
        secretStore,
        turnRecorder: {
          startModelRequest: vi.fn(() => span),
          startToolCall: vi.fn(() => span),
          startPolicyDecision: vi.fn(() => span),
          recordContextEvent: vi.fn(),
          finish: vi.fn(),
        },
      },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.toolResultContent).toBe('stdout:[secret]:[secret-ref]')
    expect(span.complete).toHaveBeenCalledWith(expect.objectContaining({
      output: 'stdout:[secret]:[secret-ref]',
      diagnostics: {
        data: { nested: ['value=[secret]', { ref: '[secret-ref]' }] },
        stderr: 'stderr=[secret]',
      },
    }))
  })

  it('工具失败回显任意格式的 SecretRef 真实值时深度脱敏运行结果和观测证据', async () => {
    const secret = 'p@$$w0rd\n[]{}.*?'
    const secretRef = { kind: 'secret_ref' as const, id: 'secret-id-1', scope: 'turn' as const }
    const span = { id: 'tool-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const secretStore = createMockSecretStore(secret)
    const tool = createReadTool({
      execute: async () => ({
        ok: false,
        result: `failed:${secret}:secret-id-1`,
        diagnostics: { data: { nested: [secret] }, stderr: `stderr=${secret}` },
      }),
    })

    const result = await executeToolStep({
      task: createTask(),
      registry: new ToolRegistry([tool], undefined, secretStore),
      requestedToolCall: { toolName: 'read_file', input: { path: secretRef } },
      currentModelText: '',
      currentToolMessages: [],
      step: 1,
      config: {
        eventEmitter: createMockEmitter(),
        logger: createMockLogger(),
        secretStore,
        turnRecorder: {
          startModelRequest: vi.fn(() => span),
          startToolCall: vi.fn(() => span),
          startPolicyDecision: vi.fn(() => span),
          recordContextEvent: vi.fn(),
          finish: vi.fn(),
        },
      },
      beforeToolExecute: async () => ({ outcome: 'allow' }),
    })

    expect(result.toolResultContent).toBe('failed:[secret]:[secret-ref]')
    expect(span.fail).toHaveBeenCalledWith(expect.objectContaining({
      error: 'failed:[secret]:[secret-ref]',
      output: 'failed:[secret]:[secret-ref]',
      diagnostics: { data: { nested: ['[secret]'] }, stderr: 'stderr=[secret]' },
    }))
  })
})

describe('createInvalidToolArgsResult 行为', () => {
  it('publish_visualization 参数错误时返回结构化失败 envelope', async () => {
    const result = await createInvalidToolArgsResult({
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      conversationId: 'conv-1',
      requestedToolCall: {
        toolName: 'publish_visualization',
        input: {},
        invalidArgsError: 'html is required',
      },
      currentModelText: '',
      currentToolMessages: [],
    })

    expect(JSON.parse(result.toolResultContent)).toEqual(expect.objectContaining({ success: false, status: 'failed', message: expect.stringContaining('html is required') }))
  })

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

  it('无效工具参数 span 继承模型 span', async () => {
    const span = { id: 'tool-span', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const startToolCall = vi.fn(() => span)

    await createInvalidToolArgsResult({
      config: {
        eventEmitter: createMockEmitter(),
        logger: createMockLogger(),
        turnRecorder: {
          startModelRequest: vi.fn(() => span),
          startToolCall,
          startPolicyDecision: vi.fn(() => span),
          recordContextEvent: vi.fn(),
          finish: vi.fn(),
        },
      },
      conversationId: 'conv-1',
      requestedToolCall: { toolName: 'bash', input: {}, invalidArgsError: 'command is required' },
      currentModelText: '',
      currentToolMessages: [],
      parentSpanId: 'model-span',
    })

    expect(startToolCall).toHaveBeenCalledWith(expect.any(Object), 'model-span')
  })
})
