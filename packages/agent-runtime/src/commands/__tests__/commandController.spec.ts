import { describe, expect, it, vi } from 'vitest'
import { createCommandController } from '../commandController'

const summarizeMock = vi.hoisted(() =>
  vi.fn(async (_serialized: string) => ({
    text: 'new compact summary',
    usage: { inputTokens: 10000, outputTokens: 250, totalTokens: 10250 },
  })),
)

vi.mock('@ant-chat/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ant-chat/agent-core')>()
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
    },
    messageRepository: {
      listByConversation: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    modelCatalog: {
      getModelById: vi.fn(),
      getProviderById: vi.fn(),
    },
  }
  return {
    appDataContext: appDataContext as any,
    eventEmitter: {} as any,
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
    { id: 'u2', convId: conversationId, role: 'user', status: 'success', content: [{ type: 'text', text: 'recent request' }], createdAt: 3 },
    { id: 'a2', convId: conversationId, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'recent answer' }], createdAt: 4 },
  ]
}

describe('commandController task guard', () => {
  it('rejects /compact when an agent task is running', async () => {
    const deps = mockDeps({ activeTasks: [{ status: 'running' }] })
    const cc = createCommandController(deps as any)

    await expect(
      cc.runBuiltinCommand({
        id: 'compact',
        conversationId: 'conv-1',
        modelConfig: { modelId: '', systemPrompt: '', temperature: 0, maxTokens: 0 },
        workspacePath: '',
      }),
    ).rejects.toThrow('Agent task is running')
  })

  it('rejects /fork when an agent task is awaiting_approval', async () => {
    const deps = mockDeps({ activeTasks: [{ status: 'awaiting_approval' }] })
    const cc = createCommandController(deps as any)

    await expect(
      cc.runBuiltinCommand({
        id: 'fork',
        conversationId: 'conv-1',
        modelConfig: { modelId: '', systemPrompt: '', temperature: 0, maxTokens: 0 },
        workspacePath: '',
      }),
    ).rejects.toThrow('Agent task is running')
  })

  it('allows /new without active conversation', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.create.mockResolvedValue({ id: 'new-conv', title: 'Untitled' })
    const cc = createCommandController(deps as any)

    const result = await cc.runBuiltinCommand({
      id: 'new',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0.7, maxTokens: 4096 },
      workspacePath: '/ws',
    })
    expect(result.status).toBe('success')
    if (result.status !== 'success') {
      throw new Error('Expected /new to succeed')
    }
    expect(result.conversationId).toBe('new-conv')
  })

  it('/compact ignores compaction.enabled flag (manual override)', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      settings: { compaction: { enabled: false, thresholdPercent: 70, keepRecentPairs: 1 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue(compressibleMessages())
    const cc = createCommandController(deps as any)

    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'event-1' })
    deps.appDataContext.modelCatalog.getModelById.mockResolvedValue(null)

    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') {
      throw new Error('Expected /compact to fail')
    }
    expect(result.errorMessage).toContain('未找到压缩模型')
  })

  it('rejects unknown command id', async () => {
    const deps = mockDeps()
    const cc = createCommandController(deps as any)
    await expect(
      cc.runBuiltinCommand({
        id: 'unknown-cmd',
        modelConfig: { modelId: '', systemPrompt: '', temperature: 0, maxTokens: 0 },
        workspacePath: '',
      }),
    ).rejects.toThrow('Unknown built-in command')
  })
})

describe('commandController command concurrency', () => {
  it('rejects second /compact on same conversation while first is running', async () => {
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
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    await expect(
      cc.runBuiltinCommand({
        id: 'compact',
        conversationId: 'conv-1',
        modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
        workspacePath: '',
      }),
    ).rejects.toThrow('already running')

    resolveFirst!([])
    await firstPromise.catch(() => {})
  })

  it('allows /compact on different conversations concurrently', async () => {
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
        modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
        workspacePath: '',
      }),
      cc.runBuiltinCommand({
        id: 'compact',
        conversationId: 'conv-2',
        modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
        workspacePath: '',
      }),
    ])

    expect(r1.status).toBe('success')
    expect(r1.summaryText).toContain('无需压缩')
    expect(r2.status).toBe('success')
    expect(r2.summaryText).toContain('无需压缩')
  })
})

describe('compact command error and cancellation', () => {
  it('/compact returns error status when model is not found', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: { compaction: { enabled: true, thresholdPercent: 70, keepRecentPairs: 1 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue(compressibleMessages())
    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'event-1' })
    deps.appDataContext.modelCatalog.getModelById.mockResolvedValue(null)

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') {
      throw new Error('Expected /compact to fail')
    }
    expect(result.errorMessage).toContain('未找到压缩模型')
    expect(deps.appDataContext.messageRepository.create).not.toHaveBeenCalled()
  })

  it('/compact with empty messages returns success without creating loading event', async () => {
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
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
    })

    expect(result.status).toBe('success')
    expect(result.summaryText).toContain('无需压缩')
    expect(deps.appDataContext.modelCatalog.getModelById).not.toHaveBeenCalled()
    expect(deps.appDataContext.messageRepository.create).not.toHaveBeenCalled()
  })

  it('/compact summarizes from the latest manual compaction summary instead of older raw messages', async () => {
    summarizeMock.mockClear()
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: { compaction: { enabled: true, thresholdPercent: 70, keepRecentPairs: 1 } },
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
      { id: 'u2', convId: 'conv-1', role: 'user', status: 'success', content: [{ type: 'text', text: 'new user request' }], createdAt: 5 },
    ])
    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'event-2' })
    deps.appDataContext.modelCatalog.getModelById.mockResolvedValue({ id: 'm1', model: 'test-model', providerId: 'provider-1' })
    deps.appDataContext.modelCatalog.getProviderById.mockResolvedValue({
      id: 'provider-1',
      name: 'provider',
      apiMode: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://example.com',
      isOfficial: false,
      isEnabled: true,
      createdAt: 1,
      updatedAt: 1,
    })

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
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
      compactedThroughMessageId: 'a2',
    })
  })

  it('cancelCommand waits for model lookup without creating a loading event', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: { compaction: { enabled: true, thresholdPercent: 70, keepRecentPairs: 1 } },
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue(compressibleMessages())
    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'event-1' })

    let rejectModelLookup: (reason?: unknown) => void
    deps.appDataContext.modelCatalog.getModelById.mockReturnValue(new Promise((_, reject) => {
      rejectModelLookup = reject
    }))

    const cc = createCommandController(deps as any)
    const runPromise = cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
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
})

describe('fork command', () => {
  it('/fork preserves event message status from source', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Original',
      settings: {},
    })
    deps.appDataContext.conversationRepository.create.mockResolvedValue({
      id: 'fork-conv',
      title: 'Original fork',
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
      .mockResolvedValueOnce({ id: 'fork-event' })
      .mockResolvedValueOnce({ id: 'fork-m1' })
      .mockResolvedValueOnce({ id: 'fork-m2' })

    const cc = createCommandController(deps as any)
    const result = await cc.runBuiltinCommand({
      id: 'fork',
      conversationId: 'conv-1',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '/ws',
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
    }))
  })

  it('/fork is blocked by concurrency guard', async () => {
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
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '/ws',
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    await expect(
      cc.runBuiltinCommand({
        id: 'fork',
        conversationId: 'conv-1',
        modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
        workspacePath: '/ws',
      }),
    ).rejects.toThrow('already running')

    resolveFirst!([])
    await firstPromise.catch(() => {})
  })
})
