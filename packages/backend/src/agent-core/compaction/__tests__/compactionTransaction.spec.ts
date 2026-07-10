import type { IAIProvider } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMPACTION_SETTINGS } from '../compaction'
import { runCompactionTransaction } from '../compactionTransaction'

function entry(id: string, text: string) {
  return { sourceMessageId: id, message: { role: 'user' as const, content: [{ type: 'text' as const, text }] } }
}

const provider = { streamModel: vi.fn(), complete: vi.fn() } as unknown as IAIProvider
const modelInfo = { provider: 'test', providerId: 'provider-1', model: 'model-1' }

describe('compaction transaction 行为', () => {
  it('automatic 未达到阈值时不创建事件', async () => {
    const persistence = { createLoading: vi.fn(), update: vi.fn(), delete: vi.fn() }
    const entries = [entry('u1', 'short')]

    const result = await runCompactionTransaction({
      trigger: 'automatic',
      conversationId: 'conv-1',
      contextEntries: entries,
      pendingUserMessage: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      settings: DEFAULT_COMPACTION_SETTINGS,
      aiProvider: provider,
      modelName: 'model-1',
      modelInfo,
      contextLength: 128_000,
      summarize: vi.fn(),
      persistence,
    })

    expect(result.status).toBe('skipped')
    expect(persistence.createLoading).not.toHaveBeenCalled()
  })

  it('manual 成功时原位更新事件并写入精确 cut-point', async () => {
    const persistence = { createLoading: vi.fn(async () => ({ id: 'event-1' })), update: vi.fn(), delete: vi.fn() }
    const entries = [entry('u1', 'first'), entry('a1', 'second'), entry('u2', 'third'), entry('a2', 'recent')]

    const result = await runCompactionTransaction({
      trigger: 'manual',
      conversationId: 'conv-1',
      contextEntries: entries,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 1 },
      aiProvider: provider,
      modelName: 'model-1',
      modelInfo,
      summarize: vi.fn(async () => ({ text: 'summary', usage: { totalTokens: 8 } })),
      persistence,
    })

    expect(result.status).toBe('compacted')
    expect(persistence.update).toHaveBeenCalledWith('event-1', expect.objectContaining({ status: 'success', compactedThroughMessageId: 'u2', usage: { totalTokens: 8 } }))
  })

  it('取消时删除 loading event', async () => {
    const controller = new AbortController()
    const persistence = { createLoading: vi.fn(async () => ({ id: 'event-1' })), update: vi.fn(), delete: vi.fn() }
    const entries = [entry('u1', 'first'), entry('a1', 'second'), entry('u2', 'third'), entry('a2', 'recent')]

    const result = await runCompactionTransaction({
      trigger: 'manual',
      conversationId: 'conv-1',
      contextEntries: entries,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 1 },
      aiProvider: provider,
      modelName: 'model-1',
      modelInfo,
      abortSignal: controller.signal,
      summarize: vi.fn(async () => {
        controller.abort()
        return { text: 'summary' }
      }),
      persistence,
    })

    expect(result.status).toBe('cancelled')
    expect(persistence.delete).toHaveBeenCalledWith('event-1')
  })
})
