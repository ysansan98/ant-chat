import { describe, expect, it, vi } from 'vitest'
import { compactMessages, DEFAULT_COMPACTION_SETTINGS, estimateContextTokens, getContextWindow, planCompaction } from '../compaction'
import type { IAIProvider, LoopMessage } from '@ant-chat/shared'

function makeTextMsg(role: LoopMessage['role'], text: string): LoopMessage {
  return { role, content: [{ type: 'text', text }] }
}

function makeToolCallMsg(toolCallId: string, toolName: string, args: Record<string, unknown> = {}): LoopMessage {
  return { role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName, args }] }
}

function makeToolResultMsg(toolCallId: string, toolName: string, result: string, isError = false): LoopMessage {
  return { role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName, result, isError }] }
}

describe('estimateContextTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateContextTokens([])).toBe(0)
  })

  it('estimates text messages by length / 4 + overhead', () => {
    const msg = makeTextMsg('user', 'Hello World') // 11 chars
    const tokens = estimateContextTokens([msg])
    // 11/4 is about 3, plus 4 overhead equals 7.
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBe(Math.ceil(11 / 4) + 4)
  })

  it('estimates tool-call messages by JSON length + overhead', () => {
    const msg = makeToolCallMsg('tc1', 'bash', { command: 'ls' })
    const tokens = estimateContextTokens([msg])
    expect(tokens).toBeGreaterThan(0)
  })

  it('estimates tool-result messages with string result', () => {
    const msg = makeToolResultMsg('tc1', 'bash', 'file listing output', false)
    const tokens = estimateContextTokens([msg])
    expect(tokens).toBeGreaterThan(0)
  })

  it('sums tokens across multiple messages', () => {
    const msgs = [
      makeTextMsg('user', 'Hello'),
      makeTextMsg('assistant', 'Hi there'),
    ]
    const total = estimateContextTokens(msgs)
    const single = estimateContextTokens([msgs[0]])
    expect(total).toBeGreaterThan(single)
  })
})

describe('compactMessages manual trigger', () => {
  const noopAiProvider = {} as IAIProvider

  it('skips enabled and threshold checks with enough compactable history', async () => {
    const summarize = vi.fn().mockResolvedValue({
      text: 'manual summary',
      usage: { inputTokens: 9000, outputTokens: 300, totalTokens: 9300 },
    })
    const messages = [
      makeTextMsg('user', 'Q1'.repeat(20_000)),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('user', 'Q2'),
      makeTextMsg('assistant', 'A2'),
    ]

    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, enabled: false, thresholdPercent: 90, keepRecentPairs: 1 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      preEstimatedTokens: 1,
      summarize,
      trigger: 'manual',
    })

    expect(result.compacted).toBe(true)
    expect(result.summaryText).toBe('manual summary')
    expect(result.summarizedCount).toBe(2)
    expect(result.keptLength).toBe(2)
    expect(result.usage).toEqual({ inputTokens: 9000, outputTokens: 300, totalTokens: 9300 })
    expect(summarize).toHaveBeenCalledOnce()
  })

  it('does not summarize a short conversation', async () => {
    const summarize = vi.fn().mockResolvedValue({ text: 'unused summary' })
    const messages = [
      makeTextMsg('user', 'Q1'),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('user', 'Q2'),
      makeTextMsg('assistant', 'A2'),
    ]

    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentPairs: 1 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      summarize,
      trigger: 'manual',
    })

    expect(result.compacted).toBe(false)
    expect(result.skipReason).toBe('insufficient-history')
    expect(summarize).not.toHaveBeenCalled()
  })

  it('returns summarizedCount matching the summarized prefix', async () => {
    const messages = [
      makeTextMsg('user', 'Q1'.repeat(20_000)),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('user', 'Q2'),
      makeTextMsg('assistant', 'A2'),
      makeTextMsg('user', 'Q3'),
      makeTextMsg('assistant', 'A3'),
      makeTextMsg('user', 'Q4'),
      makeTextMsg('assistant', 'A4'),
      makeTextMsg('user', 'Q5'),
      makeTextMsg('assistant', 'A5'),
    ]

    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentPairs: 3 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      preEstimatedTokens: 100_000,
      summarize: async () => ({ text: 'summary' }),
      trigger: 'manual',
    })

    expect(result.compacted).toBe(true)
    expect(result.summarizedCount).toBe(4)
    expect(result.keptLength).toBe(6)
    expect(result.summarizedCount! + result.keptLength!).toBe(messages.length)
  })

  it('preserves usage when the summary is empty', async () => {
    const messages = [
      makeTextMsg('user', 'Q1'.repeat(20_000)),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('user', 'Q2'),
    ]
    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentPairs: 1 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      summarize: async () => ({
        text: ' ',
        usage: { inputTokens: 8500, outputTokens: 1, totalTokens: 8501 },
      }),
      trigger: 'manual',
    })

    expect(result.compacted).toBe(false)
    expect(result.summaryError).toBe('上下文压缩返回了空摘要。')
    expect(result.usage).toEqual({ inputTokens: 8500, outputTokens: 1, totalTokens: 8501 })
  })

  it('plans manual compaction by compactable prefix tokens', () => {
    const shortPlan = planCompaction({
      messages: [
        makeTextMsg('user', 'short'),
        makeTextMsg('assistant', 'answer'),
        makeTextMsg('user', 'recent'),
      ],
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentPairs: 1 },
      providerFormat: 'openai',
      trigger: 'manual',
    })
    expect(shortPlan).toEqual({ eligible: false, reason: 'insufficient-history' })
  })
})

describe('getContextWindow', () => {
  it('returns known provider window sizes', () => {
    expect(getContextWindow('anthropic')).toBe(200_000)
    expect(getContextWindow('deepseek')).toBe(128_000)
    expect(getContextWindow('openai')).toBe(128_000)
    expect(getContextWindow('google')).toBe(1_000_000)
  })

  it('returns default window for unknown providers', () => {
    expect(getContextWindow('unknown')).toBe(128_000)
    expect(getContextWindow('')).toBe(128_000)
  })
})

describe('compactMessages', () => {
  const noopAiProvider = {} as IAIProvider

  it('returns unchanged when compaction disabled', async () => {
    const messages = [makeTextMsg('user', 'hello')]
    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, enabled: false },
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      summarize: async () => ({ text: 'summary' }),
    })
    expect(result.compacted).toBe(false)
    expect(result.messages).toBe(messages)
  })

  it('returns unchanged when under threshold', async () => {
    const messages = [makeTextMsg('user', 'hello')]
    const result = await compactMessages({
      messages,
      settings: DEFAULT_COMPACTION_SETTINGS,
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      summarize: async () => ({ text: 'summary' }),
    })
    expect(result.compacted).toBe(false)
  })

  it('compacts when over threshold with sufficient user pairs', async () => {
    const summary = 'This is a summary of previous conversation.'
    const summarize = vi.fn().mockResolvedValue({ text: summary })

    // Need enough user messages: keepRecentPairs=3 requires more than 3 user messages for a cut point.
    // 4 user-assistant pairs = 8 messages, cutIndex will be at the 2nd message
    const messages = [
      makeTextMsg('user', 'Q1'.repeat(20_000)),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('user', 'Q2'),
      makeTextMsg('assistant', 'A2'),
      makeTextMsg('user', 'Q3'),
      makeTextMsg('assistant', 'A3'),
      makeTextMsg('user', 'Q4'),
      makeTextMsg('assistant', 'A4'),
    ]

    const result = await compactMessages({
      messages,
      settings: DEFAULT_COMPACTION_SETTINGS,
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      preEstimatedTokens: 100_000,
      summarize,
    })

    expect(result.compacted).toBe(true)
    expect(result.summaryText).toBe(summary)
    // First message should be the summary injection (as user role)
    const firstMsg = result.messages[0]
    expect(firstMsg.role).toBe('user')
    const textContent = firstMsg.content.find(c => c.type === 'text')
    expect(textContent).toBeDefined()
    if (textContent && textContent.type === 'text') {
      expect(textContent.text).toContain(summary)
      expect(textContent.text).toContain('<summary>')
    }
  })

  it('keeps recent user-assistant pairs', async () => {
    const summarize = vi.fn().mockResolvedValue({ text: 'summary' })

    // 5 pairs, keepRecentPairs=3 keeps last 3 pairs (Q3-Q5 + their A's).
    const messages = [
      makeTextMsg('user', 'Q1'.repeat(20_000)),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('user', 'Q2'),
      makeTextMsg('assistant', 'A2'),
      makeTextMsg('user', 'Q3'),
      makeTextMsg('assistant', 'A3'),
      makeTextMsg('user', 'Q4'),
      makeTextMsg('assistant', 'A4'),
      makeTextMsg('user', 'Q5'),
      makeTextMsg('assistant', 'A5'),
    ]

    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentPairs: 3 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      preEstimatedTokens: 100_000,
      summarize,
    })

    expect(result.compacted).toBe(true)
    // The compacted result should contain summary + kept pairs
    const keptUserTexts = result.messages
      .filter(m => m.role === 'user')
      .map(m => m.content.find(c => c.type === 'text'))
      .filter(Boolean)
      .map(c => c && c.type === 'text' ? c.text : '')

    // Q1, Q2 should be summarized away; Q3, Q4, Q5 should be kept
    expect(keptUserTexts.some(t => t.includes('Q1'))).toBe(false)
    expect(keptUserTexts.some(t => t.includes('Q2'))).toBe(false)
    expect(keptUserTexts.some(t => t.includes('Q3'))).toBe(true)
    expect(keptUserTexts.some(t => t.includes('Q4'))).toBe(true)
    expect(keptUserTexts.some(t => t.includes('Q5'))).toBe(true)
  })

  it('returns unchanged when summary function throws', async () => {
    const summarize = vi.fn().mockRejectedValue(new Error('summarization failed'))
    const messages = [
      makeTextMsg('user', 'Q1'.repeat(20_000)),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('user', 'Q2'),
      makeTextMsg('assistant', 'A2'),
      makeTextMsg('user', 'Q3'),
      makeTextMsg('assistant', 'A3'),
      makeTextMsg('user', 'Q4'),
      makeTextMsg('assistant', 'A4'),
    ]

    const result = await compactMessages({
      messages,
      settings: DEFAULT_COMPACTION_SETTINGS,
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      preEstimatedTokens: 100_000,
      summarize,
    })

    expect(result.compacted).toBe(false)
    expect(result.messages).toBe(messages)
  })

  it('returns unchanged when no safe cut point found', async () => {
    const summarize = vi.fn().mockResolvedValue({ text: 'summary' })

    // Only 1 user message, need to keep 3 pairs
    const messages = [
      makeTextMsg('user', 'Only question'),
      makeTextMsg('assistant', 'Only answer'),
    ]

    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentPairs: 3 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      providerFormat: 'openai',
      preEstimatedTokens: 100_000,
      summarize,
    })

    expect(result.compacted).toBe(false)
  })
})
