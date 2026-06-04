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

describe('fork toolCallId pairing', () => {
  it('stable remap: same original toolCallId → same new id', () => {
    const toolCallIdMap = new Map<string, string>()

    // Replicate the logic from remapToolRef for direct testing
    function remapToolRef(originalId: string, map: Map<string, string>): string {
      const existing = map.get(originalId)
      if (existing)
        return existing
      const newId = `mapped-${originalId}`
      map.set(originalId, newId)
      return newId
    }

    const originalId = 'tool-call-abc'

    const id1 = remapToolRef(originalId, toolCallIdMap)
    const id2 = remapToolRef(originalId, toolCallIdMap)
    const id3 = remapToolRef('other-id', toolCallIdMap)

    expect(id1).toBe(id2)
    expect(id1).not.toBe(id3)
    expect(toolCallIdMap.size).toBe(2)
  })
})
