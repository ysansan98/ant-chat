import { describe, expect, it, vi } from 'vitest'
import { createCommandController } from '../commandController'

function mockDeps(overrides: { activeTasks?: Array<{ status: string }> } = {}) {
  const appDataContext = {
    conversationRepository: {
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    messageRepository: {
      listByConversation: vi.fn(),
      create: vi.fn().mockReturnValue({ id: 'loading-1' }),
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
    // enabled: false does NOT block manual /compact. With force:true,
    // any non-empty conversation triggers the compaction path -> model lookup.
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      settings: { compaction: { enabled: false, thresholdPercent: 70, keepRecentPairs: 3 } },
    })
    // Enough content to surpass thresholdPercent=0
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue([
      { id: 'm1', role: 'user', content: [{ type: 'text', text: 'x'.repeat(100) }], createdAt: 1 },
    ])
    const cc = createCommandController(deps as any)

    const result = await cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
    })
    // Model lookup is attempted (not blocked by enabled:false) but fails
    // with structured error status instead of throwing.
    expect(result.status).toBe('error')
    if (result.status !== 'error') {
      throw new Error('Expected /compact to fail')
    }
    expect(result.errorMessage).toContain('Model not found')
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

    // First call hangs on listByConversation
    let resolveFirst: (value: unknown) => void
    const firstMessages = new Promise<unknown>((resolve) => {
      resolveFirst = resolve
    })
    deps.appDataContext.messageRepository.listByConversation.mockReturnValue(firstMessages)

    const cc = createCommandController(deps as any)

    // Start first compact (will hang)
    const firstPromise = cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
    })

    // Allow microtask queue to flush so activeCommands is populated
    await new Promise(r => setTimeout(r, 10))

    // Second compact must be rejected
    await expect(
      cc.runBuiltinCommand({
        id: 'compact',
        conversationId: 'conv-1',
        modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
        workspacePath: '',
      }),
    ).rejects.toThrow('already running')

    // Cleanup: resolve first and let it complete
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

    const p1 = cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-1',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
    })
    const p2 = cc.runBuiltinCommand({
      id: 'compact',
      conversationId: 'conv-2',
      modelConfig: { modelId: 'm1', systemPrompt: '', temperature: 0, maxTokens: 0 },
      workspacePath: '',
    })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.status).toBe('success')
    expect(r1.summaryText).toContain('No messages')
    expect(r2.status).toBe('success')
    expect(r2.summaryText).toContain('No messages')
  })
})

describe('compact command error and cancellation', () => {
  it('/compact returns error status when model is not found', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: {},
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue([
      { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], createdAt: 1 },
    ])
    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'event-1' })
    deps.appDataContext.messageRepository.update.mockResolvedValue(undefined)
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
    expect(result.errorMessage).toContain('Model not found')
    expect(deps.appDataContext.messageRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'event-1', status: 'error' }),
    )
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
    expect(result.summaryText).toContain('No messages')
    // Model catalog should not be called for empty conversations
    expect(deps.appDataContext.modelCatalog.getModelById).not.toHaveBeenCalled()
    // No loading event should be created
    expect(deps.appDataContext.messageRepository.create).not.toHaveBeenCalled()
  })

  it('cancelCommand waits until the loading event is deleted', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Test',
      settings: {},
    })
    deps.appDataContext.messageRepository.listByConversation.mockResolvedValue([
      { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], createdAt: 1 },
    ])
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

    await new Promise(r => setTimeout(r, 10))

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
    expect(deps.appDataContext.messageRepository.delete).toHaveBeenCalledWith('event-1')
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
      { id: 'm2', role: 'event', status: 'error', eventType: 'compaction', content: [{ type: 'text', text: 'fail' }], createdAt: 2 },
    ])
    deps.appDataContext.messageRepository.create.mockResolvedValue({ id: 'new-id' })

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

    // The event message should be created with status 'error', not hardcoded 'success'
    const createCalls = deps.appDataContext.messageRepository.create.mock.calls
    const eventCall = createCalls.find((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>
      return arg.role === 'event' && arg.eventType === 'compaction'
    })
    expect(eventCall).toBeDefined()
    expect((eventCall![0] as Record<string, unknown>).status).toBe('error')
  })

  it('/fork is blocked by concurrency guard', async () => {
    const deps = mockDeps()
    deps.appDataContext.conversationRepository.getById.mockResolvedValue({
      id: 'conv-1',
      title: 'Original',
      settings: {},
    })

    // Make listByConversation hang so first fork is stuck
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

    await new Promise(r => setTimeout(r, 10))

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
