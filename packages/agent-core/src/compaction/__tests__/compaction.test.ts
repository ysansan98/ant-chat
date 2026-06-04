import { describe, expect, it, vi } from 'vitest'
import { compactMessages, DEFAULT_COMPACTION_SETTINGS } from '../compaction'

function mockAiProvider() {
  return { complete: vi.fn().mockResolvedValue({ text: 'summary text' }) } as any
}

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: [{ type: 'text' as const, text: `message ${i}` }],
  }))
}

describe('compactMessages force mode', () => {
  it('force: true skips enabled: false and attempts compaction', async () => {
    const messages = makeMessages(8)
    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, enabled: false },
      aiProvider: mockAiProvider(),
      model: 'test-model',
      providerFormat: 'openai',
      summarize: async () => 'forced summary',
      force: true,
      preEstimatedTokens: 100,
    })
    expect(result.compacted).toBe(true)
    expect(result.summaryText).toBe('forced summary')
    expect(result.summarizedCount).toBeGreaterThan(0)
    expect(result.keptLength).toBeGreaterThan(0)
  })

  it('force: true skips thresholdPercent even when tokens are under threshold', async () => {
    const messages = makeMessages(8)
    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, thresholdPercent: 99 },
      aiProvider: mockAiProvider(),
      model: 'test-model',
      providerFormat: 'openai',
      summarize: async () => 'forced summary',
      force: true,
      preEstimatedTokens: 100,
    })
    expect(result.compacted).toBe(true)
    expect(result.summaryText).toBe('forced summary')
    expect(result.summarizedCount).toBeGreaterThan(0)
  })

  it('force: false respects enabled: false', async () => {
    const messages = makeMessages(4)
    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, enabled: false },
      aiProvider: mockAiProvider(),
      model: 'test-model',
      providerFormat: 'openai',
      summarize: async () => 'should not be called',
    })
    expect(result.compacted).toBe(false)
    expect(result.summaryText).toBeUndefined()
  })

  it('force: true on short conversation still compacts with a fallback cut point', async () => {
    const messages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hi' }] },
    ]
    const summarize = vi.fn().mockResolvedValue('short summary')
    const result = await compactMessages({
      messages,
      settings: DEFAULT_COMPACTION_SETTINGS,
      aiProvider: mockAiProvider(),
      model: 'test-model',
      providerFormat: 'openai',
      summarize,
      force: true,
    })
    expect(result.compacted).toBe(true)
    expect(result.summaryText).toBe('short summary')
    expect(result.summarizedCount).toBe(1)
    expect(result.keptLength).toBe(1)
    expect(summarize).toHaveBeenCalledOnce()
  })

  it('force: true on a single-message conversation summarizes the whole conversation', async () => {
    const messages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] },
    ]
    const result = await compactMessages({
      messages,
      settings: DEFAULT_COMPACTION_SETTINGS,
      aiProvider: mockAiProvider(),
      model: 'test-model',
      providerFormat: 'openai',
      summarize: async () => 'single summary',
      force: true,
    })
    expect(result.compacted).toBe(true)
    expect(result.summaryText).toBe('single summary')
    expect(result.summarizedCount).toBe(1)
    expect(result.keptLength).toBe(0)
  })

  it('returns summarizedCount matching toSummarize length', async () => {
    const messages = makeMessages(10)
    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentPairs: 3, thresholdPercent: 0 },
      aiProvider: mockAiProvider(),
      model: 'test-model',
      providerFormat: 'openai',
      summarize: async () => 'summary',
      preEstimatedTokens: 200_000,
    })
    expect(result.compacted).toBe(true)
    expect(result.summarizedCount).toBe(4)
    expect(result.keptLength).toBe(6)
    expect(result.summarizedCount! + result.keptLength!).toBe(10)
  })

  it('handles summarize throwing an error', async () => {
    const messages = makeMessages(8)
    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, thresholdPercent: 0 },
      aiProvider: mockAiProvider(),
      model: 'test-model',
      providerFormat: 'openai',
      summarize: async () => { throw new Error('API error') },
      preEstimatedTokens: 200_000,
    })
    expect(result.compacted).toBe(false)
    expect(result.summaryError).toBe('API error')
  })
})
