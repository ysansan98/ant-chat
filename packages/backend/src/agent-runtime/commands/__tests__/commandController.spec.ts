import { describe, expect, it, vi } from 'vitest'
import { createConversationLifecycle } from '../../../conversations/conversationLifecycle'
import { createCommandController } from '../commandController'

const summarizeMock = vi.hoisted(() =>
  vi.fn(async (_serialized: string, _aiProvider?: unknown, _model?: string, _abortSignal?: AbortSignal, _instruction?: string) => ({
    text: 'new compact summary',
    usage: { inputTokens: 10000, outputTokens: 250, totalTokens: 10250 },
  })),
)

vi.mock('../../../agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../agent-core')>()
  return {
    ...actual,
    createProvider: vi.fn(async () => ({})),
    createCompactionStrategy: vi.fn(() => ({ summarize: summarizeMock })),
  }
})

function mockDeps(overrides: { activeTasks?: Array<{ status: string }> } = {}) {
  const appDataContext = {
    conversationRepository: {
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    loadAttachmentData: vi.fn(),
    workspaceService: {},
    messageRepository: {
      listByConversation: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    modelCatalog: {
      getModel: vi.fn(),
      getProvider: vi.fn(),
      resolveModel: vi.fn(),
    },
  }
  const conversationLifecycle = createConversationLifecycle({
    data: appDataContext as never,
    events: { emit: vi.fn() },
    runtime: { closeConversation: vi.fn(), listActiveTasks: vi.fn(() => []) },
  })
  return {
    appDataContext: appDataContext as any,
    conversationLifecycle,
    eventEmitter: {
      emitMessageUpdated: vi.fn(),
    } as any,
    logger: undefined,
    listActiveTasks: overrides.activeTasks
      ? vi.fn(() => overrides.activeTasks)
      : vi.fn(() => []),
  }
}

function compressibleMessages(conversationId = 'conv-1') {
  return [
    { id: 'u1', convId: conversationId, role: 'user', status: 'success', content: [{ type: 'text', text: 'x'.repeat(40_000) }], createdAt: 1 },
    { id: 'a1', convId: conversationId, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'first answer' }], createdAt: 2 },
    { id: 'a1-follow-up', convId: conversationId, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'first answer follow-up' }], createdAt: 3 },
    { id: 'u2', convId: conversationId, role: 'user', status: 'success', content: [{ type: 'text', text: 'recent request' }], createdAt: 4 },
    { id: 'a2', convId: conversationId, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'recent answer' }], createdAt: 5 },
  ]
}

describe('commandController 任务守卫', () => {
  it('agent task 正在运行时拒绝 /compact', async () => {
    const deps = mockDeps({ activeTasks: [{ status: 'running' }] })
    const cc = createCommandController(deps as any)

    await expect(
      cc.runBuiltinCommand({
        id: 'compact',
        conversationId: 'conv-1',
        workspacePath: '',
        modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
        conversationInstructions: '',
      }),
    ).rejects.toThrow('Agent task is running')
  })

  it('agent task 等待审批时拒绝 /fork', async () => {
    const deps = mockDeps({ activeTasks: [{ status: 'awaiting_approval' }] })
    const cc = createCommandController(deps as any)

    await expect(
      cc.runBuiltinCommand({
        id: 'fork',
        conversationId: 'conv-1',
        workspacePath: '',
        modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
        conversationInstructions: '',
      }),
    ).rejects.toThrow('Agent task is running')
  })

  it('没有活跃会话时允许执行 /new', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.create.mockResolvedValue({ id: 'new-conv', title: 'Untitled' })
    const cc = createCommandController(deps as any)

    const result = await cc.runBuiltinCommand({
      id: 'new',
      workspacePath: '/ws',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider', reasoningEffort: 'high' },
      conversationInstructions: '请使用中文回答',
    })
    expect(result.status).toBe('success')
    if (result.status !== 'success') {
      throw new Error('Expected /new to succeed')
    }
    expect(result.conversationId).toBe('new-conv')
    expect(deps.appDataContext.conversationRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      conversationInstructions: '请使用中文回答',
      settings: expect.objectContaining({
        reasoningEffort: 'high',
      }),
    }))
  })

  it('/compact 忽略 compaction.enabled 配置并执行手动压缩', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      settings: { compaction: { enabled: false, thresholdPercent: 70, keepRecentTokens: 16 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue(compressibleMessages())
    const cc = createCommandController(deps as any)

    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'event-1' })
    deps.appDataContext.modelCatalog.resolveModel.mockResolvedValue(null)

    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      workspacePath: '',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') {
      throw new Error('Expected /compact to fail')
    }
    expect(result.errorMessage).toContain('未找到压缩模型')
  })

  it('拒绝未知内置命令 id', async () => {
    const deps = mockDeps()
    const cc = createCommandController(deps as any)
    await expect(
      cc.runBuiltinCommand({
        id: 'unknown-cmd',
        workspacePath: '',
        modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
        conversationInstructions: '',
      }),
    ).rejects.toThrow('Unknown built-in command')
  })
})

describe('commandController 命令并发', () => {
  it('同一会话已有 /compact 运行时拒绝第二次 /compact', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: {},
    })

    let resolveFirst: (value: unknown) => void
    const firstMessages = new Promise<unknown>((resolve) => {
      resolveFirst = resolve
    })
    deps.appDataContext.messageRepository.listByConversation.mockReturnValue(firstMessages)

    const cc = createCommandController(deps as any)
    const firstPromise = cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      workspacePath: '',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    await expect(
      cc.runBuiltinCommand({
        id: 'compact',
        conversationId: 'conv-1',
        workspacePath: '',
        modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
        conversationInstructions: '',
      }),
    ).rejects.toThrow('already running')

    resolveFirst!([])
    await firstPromise.catch(() => {})
  })

  it('允许不同会话并发执行 /compact', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: {},
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue([])

    const cc = createCommandController(deps as any)

    const [r1, r2] = await Promise.all([
      cc.runBuiltinCommand({
        id: 'compact',
        conversationId: 'conv-1',
        workspacePath: '',
        modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
        conversationInstructions: '',
      }),
      cc.runBuiltinCommand({
        id: 'compact',
        conversationId: 'conv-2',
        workspacePath: '',
        modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
        conversationInstructions: '',
      }),
    ])

    expect(r1.status).toBe('success')
    expect(r1.summaryText).toContain('无需压缩')
    expect(r2.status).toBe('success')
    expect(r2.summaryText).toContain('无需压缩')
  })
})

describe('compact 命令错误和取消', () => {
  it('/compact 发出 loading 和 completed event message', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: { compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 16 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue(compressibleMessages())
    deps.appDataContext.modelCatalog.resolveModel.mockResolvedValue({
      model: { id: 'm1', model: 'test-model', providerId: 'provider-1' },
      provider: {
        id: 'provider-1',
        name: 'provider',
        apiMode: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        isOfficial: false,
        isEnabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    })

    const loadingEvent = {
      id: 'event-1',
      convId: 'conv-1',
      role: 'event',
      status: 'loading',
      content: [{ type: 'text', text: '正在压缩上下文...' }],
      eventType: 'compaction',
      createdAt: 6,
    }
    const completedEvent = {
      ...loadingEvent,
      status: 'success',
      content: [{ type: 'text', text: 'new compact summary' }],
      compactedThroughMessageId: 'a1-follow-up',
    }
    deps.appDataContext.messageRepository.create.mockResolvedValue(loadingEvent)
    deps.appDataContext.messageRepository.update.mockResolvedValue(completedEvent)

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      workspacePath: '',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    expect(result.status).toBe('success')
    expect(deps.eventEmitter.emitMessageUpdated).toHaveBeenNthCalledWith(1, loadingEvent)
    expect(deps.eventEmitter.emitMessageUpdated).toHaveBeenNthCalledWith(2, completedEvent)
  })

  it('/compact 找不到模型时返回 error 状态', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: { compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 16 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue(compressibleMessages())
    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'event-1' })
    deps.appDataContext.modelCatalog.resolveModel.mockResolvedValue(null)

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      workspacePath: '',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') {
      throw new Error('Expected /compact to fail')
    }
    expect(result.errorMessage).toContain('未找到压缩模型')
    expect(deps.appDataContext.messageRepository.create).not.toHaveBeenCalled()
  })

  it('/compact 遇到空消息时直接返回 success 且不创建 loading event', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: {},
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue([])

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      workspacePath: '',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    expect(result.status).toBe('success')
    expect(result.summaryText).toContain('无需压缩')
    expect(deps.appDataContext.modelCatalog.resolveModel).not.toHaveBeenCalled()
    expect(deps.appDataContext.messageRepository.create).not.toHaveBeenCalled()
  })

  it('/compact 待总结前缀只有两条消息时跳过压缩', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: { compaction: { enabled: false, thresholdPercent: 100, keepRecentTokens: 16 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue([
      { id: 'u1', convId: 'conv-1', role: 'user', status: 'success', content: [{ type: 'text', text: 'old request' }], createdAt: 1 },
      { id: 'a1', convId: 'conv-1', role: 'assistant', status: 'success', content: [{ type: 'text', text: 'old answer' }], createdAt: 2 },
      { id: 'u2', convId: 'conv-1', role: 'user', status: 'success', content: [{ type: 'text', text: 'recent request' }], createdAt: 3 },
      { id: 'a2', convId: 'conv-1', role: 'assistant', status: 'success', content: [{ type: 'text', text: 'recent answer' }], createdAt: 4 },
    ])

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      workspacePath: '',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    expect(result).toEqual({
      status: 'success',
      summaryText: '当前上下文不足，无需压缩。',
    })
    expect(deps.appDataContext.modelCatalog.resolveModel).not.toHaveBeenCalled()
    expect(deps.appDataContext.messageRepository.create).not.toHaveBeenCalled()
  })

  it('/compact 从最近的手动压缩摘要继续总结而不是读取更早的原始消息', async () => {
    summarizeMock.mockClear()
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: { compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 8 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue([
      { id: 'u1', convId: 'conv-1', role: 'user', status: 'success', content: [{ type: 'text', text: 'old raw user' }], createdAt: 1 },
      { id: 'a1', convId: 'conv-1', role: 'assistant', status: 'success', content: [{ type: 'text', text: 'old raw assistant' }], createdAt: 2 },
      {
        id: 'evt-1',
        convId: 'conv-1',
        role: 'event',
        status: 'success',
        eventType: 'compaction',
        compactedThroughMessageId: 'a1',
        content: [{ type: 'text', text: `previous compact summary ${'x'.repeat(40_000)}` }],
        createdAt: 3,
      },
      { id: 'a2', convId: 'conv-1', role: 'assistant', status: 'success', content: [{ type: 'text', text: 'after summary answer' }], createdAt: 4 },
      { id: 'a2-follow-up', convId: 'conv-1', role: 'assistant', status: 'success', content: [{ type: 'text', text: 'after summary follow-up' }], createdAt: 5 },
      { id: 'u2', convId: 'conv-1', role: 'user', status: 'success', content: [{ type: 'text', text: 'new user request' }], createdAt: 6 },
    ])
    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'event-2' })
    deps.appDataContext.modelCatalog.resolveModel.mockResolvedValue({
      model: { id: 'm1', model: 'test-model', providerId: 'provider-1' },
      provider: {
        id: 'provider-1',
        name: 'provider',
        apiMode: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        isOfficial: false,
        isEnabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    })

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      workspacePath: '',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    expect(result.status).toBe('success')
    const serialized = summarizeMock.mock.calls[0]?.[0]
    expect(serialized).toContain('previous compact summary')
    expect(serialized).toContain('after summary answer')
    expect(serialized).not.toContain('old raw user')
    expect(serialized).not.toContain('old raw assistant')
    expect(deps.appDataContext.conversationRepository.update).not.toHaveBeenCalled()
    expect(deps.appDataContext.messageRepository.update).toHaveBeenCalledWith({
      id: 'event-2',
      status: 'success',
      content: [{ type: 'text', text: 'new compact summary' }],
      modelInfo: {
        provider: 'provider',
        providerId: 'provider-1',
        model: 'test-model',
      },
      usage: { inputTokens: 10000, outputTokens: 250, totalTokens: 10250 },
      compactedThroughMessageId: 'a2-follow-up',
    })
  })

  it('cancelCommand 在模型查询阶段等待完成且不创建 loading event', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: { compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 16 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue(compressibleMessages())
    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'event-1' })

    let rejectModelLookup: (reason?: unknown) => void
    deps.appDataContext.modelCatalog.resolveModel.mockReturnValue(new Promise((_, reject) => {
      rejectModelLookup = reject
    }))

    const cc = createCommandController(deps as any)
    const runPromise = cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      workspacePath: '',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    let cancelResolved = false
    const cancelPromise = cc.cancelCommand('conv-1').then((result) => {
      cancelResolved = true
      return result
    })

    await Promise.resolve()
    expect(cancelResolved).toBe(false)
    expect(deps.appDataContext.messageRepository.delete).not.toHaveBeenCalled()

    rejectModelLookup!(new Error('cancelled upstream request'))

    const cancelResult = await cancelPromise
    const runResult = await runPromise

    expect(cancelResult?.status).toBe('cancelled')
    expect(runResult.status).toBe('cancelled')
    expect(deps.appDataContext.messageRepository.create).not.toHaveBeenCalled()
    expect(deps.appDataContext.messageRepository.delete).not.toHaveBeenCalled()
  })

  it('cancelCommand 在 loading event 创建后取消时删除 loading event', async () => {
    summarizeMock.mockImplementationOnce(async (_serialized, _aiProvider, _model, abortSignal) => {
      await new Promise<void>((resolve) => {
        if (abortSignal?.aborted) {
          resolve()
          return
        }
        abortSignal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return {
        text: 'cancelled summary',
        usage: { inputTokens: 10000, outputTokens: 250, totalTokens: 10250 },
      }
    })

    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: { compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 16 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue(compressibleMessages())
    deps.appDataContext.messageRepository.create.mockResolvedValue({
      id: 'event-1',
      convId: 'conv-1',
      role: 'event',
      status: 'loading',
      content: [{ type: 'text', text: '正在压缩上下文...' }],
      eventType: 'compaction',
      createdAt: 6,
    })
    deps.appDataContext.modelCatalog.resolveModel.mockResolvedValue({
      model: { id: 'm1', model: 'test-model', providerId: 'provider-1' },
      provider: {
        id: 'provider-1',
        name: 'provider',
        apiMode: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        isOfficial: false,
        isEnabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    })

    const cc = createCommandController(deps as any)
    const runPromise = cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      workspacePath: '',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    while (deps.appDataContext.messageRepository.create.mock.calls.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }

    const cancelResult = await cc.cancelCommand('conv-1')
    const runResult = await runPromise

    expect(cancelResult?.status).toBe('cancelled')
    expect(runResult.status).toBe('cancelled')
    expect(deps.appDataContext.messageRepository.delete).toHaveBeenCalledWith('event-1')
    expect(deps.appDataContext.messageRepository.update).not.toHaveBeenCalled()
    expect(deps.eventEmitter.emitMessageUpdated).toHaveBeenCalledOnce()
  })
})

describe('fork 命令', () => {
  it('/fork 保留源 event message 状态', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Original',
      settings: {},
    })
    deps.appDataContext.conversationRepository.create.mockResolvedValue({
      id: 'fork-conv',
      title: 'Original 副本',
      settings: {},
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue([
      { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], createdAt: 1 },
      {
        id: 'm2',
        role: 'event',
        status: 'error',
        eventType: 'compaction',
        content: [{ type: 'text', text: 'fail' }],
        compactedThroughMessageId: 'm1',
        modelInfo: { provider: 'provider', providerId: 'provider-1', model: 'model-1' },
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
        createdAt: 2,
      },
    ])
    deps.appDataContext.messageRepository.create
      .mockResolvedValueOnce({ id: 'fork-m1' })
      .mockResolvedValueOnce({ id: 'fork-m2' })
      .mockResolvedValueOnce({ id: 'fork-event' })

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'fork',
      conversationId: 'conv-1',
      workspacePath: '/ws',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    expect(result.status).toBe('success')
    if (result.status !== 'success') {
      throw new Error('Expected /fork to succeed')
    }
    expect(result.conversationId).toBe('fork-conv')

    const createCalls = deps.appDataContext.messageRepository.create.mock.calls
    const eventCall = createCalls.find((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>
      return arg.role === 'event' && arg.eventType === 'compaction'
    })
    expect(eventCall).toBeDefined()
    expect(eventCall![0]).toEqual(expect.objectContaining({
      status: 'error',
      compactedThroughMessageId: 'fork-m1',
      modelInfo: { provider: 'provider', providerId: 'provider-1', model: 'model-1' },
      usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      createdAt: 2,
    }))
    expect(createCalls[0][0]).toEqual(expect.objectContaining({ role: 'user', createdAt: 1 }))
    expect(createCalls[2][0]).toEqual(expect.objectContaining({ role: 'event', eventType: 'fork' }))
    expect(createCalls[2][0].createdAt).toBeGreaterThan(createCalls[1][0].createdAt)
  })

  it('/fork 重新映射 turnId 并保持 tool-call 和 tool-result 配对', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Original',
      settings: {},
    })
    deps.appDataContext.conversationRepository.create.mockResolvedValue({
      id: 'fork-conv',
      title: 'Original 副本',
      settings: {},
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue([
      { id: 'u1', role: 'user', status: 'success', content: [{ type: 'text', text: 'read file' }], createdAt: 1 },
      {
        id: 'a1',
        role: 'assistant',
        status: 'success',
        turnId: 'u1',
        modelInfo: { provider: 'provider', providerId: 'provider-1', model: 'model-1' },
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', args: { path: 'a.ts' } }],
        createdAt: 2,
      },
      {
        id: 't1',
        role: 'tool',
        status: 'success',
        turnId: 'u1',
        content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'read_file', result: 'content', isError: false }],
        createdAt: 3,
      },
    ])
    deps.appDataContext.messageRepository.create
      .mockResolvedValueOnce({ id: 'fork-u1' })
      .mockResolvedValueOnce({ id: 'fork-a1' })
      .mockResolvedValueOnce({ id: 'fork-t1' })
      .mockResolvedValueOnce({ id: 'fork-event' })

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'fork',
      conversationId: 'conv-1',
      workspacePath: '/ws',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    expect(result.status).toBe('success')
    const createCalls = deps.appDataContext.messageRepository.create.mock.calls
    const assistantCall = createCalls.find((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>
      return arg.role === 'assistant'
    })
    const toolCall = createCalls.find((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>
      return arg.role === 'tool'
    })
    expect(assistantCall?.[0]).toEqual(expect.objectContaining({ turnId: 'fork-u1' }))
    expect(toolCall?.[0]).toEqual(expect.objectContaining({ turnId: 'fork-u1' }))

    const assistantContent = (assistantCall![0] as { content: Array<{ toolCallId: string }> }).content
    const toolContent = (toolCall![0] as { content: Array<{ toolCallId: string }> }).content
    expect(assistantContent[0].toolCallId).not.toBe('call-1')
    expect(toolContent[0].toolCallId).toBe(assistantContent[0].toolCallId)
  })

  it('/fork 被并发守卫阻断', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Original',
      settings: {},
    })

    let resolveFirst: (value: unknown) => void
    const firstMessages = new Promise<unknown>((resolve) => {
      resolveFirst = resolve
    })
    deps.appDataContext.messageRepository.listByConversation.mockReturnValue(firstMessages)

    const cc = createCommandController(deps as any)
    const firstPromise = cc.runBuiltinCommand({
      id: 'fork',
      conversationId: 'conv-1',
      workspacePath: '/ws',
      modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
      conversationInstructions: '',
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    await expect(
      cc.runBuiltinCommand({
        id: 'fork',
        conversationId: 'conv-1',
        workspacePath: '/ws',
        modelConfig: { modelId: 'test-model', providerId: 'test-provider' },
        conversationInstructions: '',
      }),
    ).rejects.toThrow('already running')

    resolveFirst!([])
    await firstPromise.catch(() => {})
  })
})
