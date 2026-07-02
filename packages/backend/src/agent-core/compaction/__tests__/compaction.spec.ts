import { describe, expect, it, vi } from 'vitest'
import { calculateContextTokens, compactMessages, DEFAULT_COMPACTION_SETTINGS, estimateContextTokens, planCompaction } from '../compaction'
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

describe('estimateContextTokens 行为', () => {
  it('空数组返回 0', () => {
    expect(estimateContextTokens([])).toBe(0)
  })

  it('按长度除以 4 加开销估算文本消息', () => {
    const msg = makeTextMsg('user', 'Hello World') // 11 chars
    const tokens = estimateContextTokens([msg])
    // 11/4 is about 3, plus 4 overhead equals 7.
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBe(Math.ceil(11 / 4) + 4)
  })

  it('按 JSON 长度加开销估算 tool-call 消息', () => {
    const msg = makeToolCallMsg('tc1', 'bash', { command: 'ls' })
    const tokens = estimateContextTokens([msg])
    expect(tokens).toBe(
      Math.ceil('bash'.length / 4)
      + Math.ceil(JSON.stringify({ command: 'ls' }).length / 4)
      + 10
      + 4,
    )
  })

  it('估算字符串结果的 tool-result 消息', () => {
    const msg = makeToolResultMsg('tc1', 'bash', 'file listing output', false)
    const tokens = estimateContextTokens([msg])
    expect(tokens).toBeGreaterThan(0)
  })

  it('累加多条消息的 token', () => {
    const msgs = [
      makeTextMsg('user', 'Hello'),
      makeTextMsg('assistant', 'Hi there'),
    ]
    const total = estimateContextTokens(msgs)
    const single = estimateContextTokens([msgs[0]])
    expect(total).toBeGreaterThan(single)
  })
})

describe('calculateContextTokens 行为', () => {
  it('使用 totalTokens 且不重复计算 token 详情', () => {
    const result = calculateContextTokens([
      {
        message: makeTextMsg('assistant', 'measured response'),
        status: 'success',
        usage: {
          inputTokens: 700,
          outputTokens: 300,
          totalTokens: 1000,
          cachedInputTokens: 500,
          reasoningTokens: 200,
        },
      },
    ])

    expect(result).toBe(1000)
  })

  it('回退使用 inputTokens 加 outputTokens', () => {
    const result = calculateContextTokens([
      {
        message: makeTextMsg('assistant', 'measured response'),
        status: 'success',
        usage: {
          inputTokens: 700,
          outputTokens: 300,
          cachedInputTokens: 500,
          reasoningTokens: 200,
        },
      },
    ])

    expect(result).toBe(1000)
  })

  it('使用最近有效成功 assistant usage 加后续消息', () => {
    const trailingUser = makeTextMsg('user', '12345678')
    const pendingUser = makeTextMsg('user', '1234')
    const result = calculateContextTokens([
      {
        message: makeTextMsg('assistant', 'older measured response'),
        status: 'success',
        usage: { totalTokens: 500 },
      },
      {
        message: makeTextMsg('assistant', 'failed response'),
        status: 'error',
        usage: { totalTokens: 9000 },
      },
      {
        message: makeTextMsg('assistant', 'latest measured response'),
        status: 'success',
        usage: { totalTokens: 1000 },
      },
      {
        message: trailingUser,
        status: 'success',
      },
    ], pendingUser)

    expect(result).toBe(
      1000
      + estimateContextTokens([trailingUser])
      + estimateContextTokens([pendingUser]),
    )
  })

  it('没有有效 assistant usage 时估算全部消息', () => {
    const messages = [
      makeTextMsg('user', 'question'),
      makeTextMsg('assistant', 'cancelled answer'),
    ]
    const pendingUser = makeTextMsg('user', 'next question')
    const result = calculateContextTokens([
      { message: messages[0], status: 'success' },
      { message: messages[1], status: 'cancel', usage: { totalTokens: 9000 } },
    ], pendingUser)

    expect(result).toBe(estimateContextTokens([...messages, pendingUser]))
  })
})

describe('compactMessages 手动触发', () => {
  const noopAiProvider = {} as IAIProvider

  it('手动触发且历史足够时跳过 enabled 和 threshold 检查', async () => {
    const summarize = vi.fn().mockResolvedValue({
      text: 'manual summary',
      usage: { inputTokens: 9000, outputTokens: 300, totalTokens: 9300 },
    })
    const messages = [
      makeTextMsg('user', 'Q1'.repeat(20_000)),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('assistant', 'A1 follow-up'),
      makeTextMsg('user', 'Q2'),
      makeTextMsg('assistant', 'A2'),
    ]

    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, enabled: false, thresholdPercent: 90, keepRecentTokens: 10 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      summarize,
      trigger: 'manual',
    })

    expect(result.compacted).toBe(true)
    expect(result.summaryText).toBe('manual summary')
    expect(result.summarizedCount).toBe(3)
    expect(result.keptLength).toBe(2)
    expect(result.usage).toEqual({ inputTokens: 9000, outputTokens: 300, totalTokens: 9300 })
    expect(summarize).toHaveBeenCalledOnce()
  })

  it('短会话不执行总结', async () => {
    const summarize = vi.fn().mockResolvedValue({ text: 'unused summary' })
    const messages = [
      makeTextMsg('user', 'Q1'),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('user', 'Q2'),
      makeTextMsg('assistant', 'A2'),
    ]

    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 10 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      summarize,
      trigger: 'manual',
    })

    expect(result.compacted).toBe(false)
    expect(result.skipReason).toBe('insufficient-history')
    expect(summarize).not.toHaveBeenCalled()
  })

  it('返回与已总结前缀匹配的 summarizedCount', async () => {
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
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 30 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      summarize: async () => ({ text: 'summary' }),
      trigger: 'manual',
    })

    expect(result.compacted).toBe(true)
    expect(result.summarizedCount).toBe(4)
    expect(result.keptLength).toBe(6)
    expect(result.summarizedCount! + result.keptLength!).toBe(messages.length)
  })

  it('摘要为空时保留 usage', async () => {
    const messages = [
      makeTextMsg('user', 'Q1'.repeat(20_000)),
      makeTextMsg('assistant', 'A1'),
      makeTextMsg('assistant', 'A1 follow-up'),
      makeTextMsg('user', 'Q2'),
    ]
    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 5 },
      aiProvider: noopAiProvider,
      model: 'test-model',
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

  it('token 切分只留下两条待总结消息时跳过手动压缩', () => {
    const plan = planCompaction({
      messages: [
        makeTextMsg('user', 'short'),
        makeTextMsg('assistant', 'answer'),
        makeTextMsg('user', 'recent'),
        makeTextMsg('assistant', 'recent answer'),
      ],
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 10 },
      trigger: 'manual',
    })
    expect(plan).toEqual({ eligible: false, reason: 'insufficient-history' })
  })

  it('token 切分留下三条待总结消息时执行手动压缩', () => {
    const plan = planCompaction({
      messages: [
        makeTextMsg('user', 'first'),
        makeTextMsg('assistant', 'first answer'),
        makeTextMsg('assistant', 'additional assistant message'),
        makeTextMsg('user', 'recent'),
        makeTextMsg('assistant', 'recent answer'),
      ],
      settings: { enabled: false, thresholdPercent: 100, keepRecentTokens: 10 },
      trigger: 'manual',
    })
    expect(plan).toEqual({
      eligible: true,
      cutIndex: 3,
      toSummarizeCount: 3,
    })
  })
})

describe('planCompaction 自动触发', () => {
  const messages = [
    makeTextMsg('user', 'Q1'),
    makeTextMsg('assistant', 'A1'),
    makeTextMsg('user', 'Q2'),
    makeTextMsg('assistant', 'A2'),
  ]

  it('使用传入的模型上下文长度和阈值百分比', () => {
    expect(planCompaction({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, thresholdPercent: 50, keepRecentTokens: 10 },
      trigger: 'automatic',
      contextTokens: 4001,
      contextLength: 8000,
    })).toEqual({
      eligible: true,
      cutIndex: 2,
      toSummarizeCount: 2,
    })

    expect(planCompaction({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, thresholdPercent: 50, keepRecentTokens: 10 },
      trigger: 'automatic',
      contextTokens: 4000,
      contextLength: 8000,
    })).toEqual({ eligible: false, reason: 'below-threshold' })
  })

  it('允许从 assistant 消息开始保留且不强制 user 边界', () => {
    const messages = [
      makeTextMsg('user', 'old request'),
      makeTextMsg('assistant', 'old answer'),
      makeTextMsg('user', 'recent request'),
      makeTextMsg('assistant', 'recent answer'),
    ]
    const keepRecentTokens = estimateContextTokens(messages.slice(1))

    expect(planCompaction({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens },
      trigger: 'automatic',
      contextTokens: 9000,
      contextLength: 10_000,
    })).toEqual({
      eligible: true,
      cutIndex: 1,
      toSummarizeCount: 1,
    })
  })

  it('token 预算落在 tool 消息时不从 tool 消息开始保留', () => {
    const messages = [
      makeTextMsg('user', 'old request'),
      makeToolCallMsg('tc1', 'bash', { command: 'printf old' }),
      makeToolResultMsg('tc1', 'bash', 'tool output that reaches the budget'),
      makeTextMsg('user', 'recent request'),
      makeTextMsg('assistant', 'recent answer'),
    ]
    const keepRecentTokens = estimateContextTokens(messages.slice(2))

    expect(planCompaction({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens },
      trigger: 'automatic',
      contextTokens: 9000,
      contextLength: 10_000,
    })).toEqual({
      eligible: true,
      cutIndex: 3,
      toSummarizeCount: 3,
    })
  })

  it('为了保留完整消息允许略微超过 token 目标', () => {
    const messages = [
      makeTextMsg('user', 'old request'),
      makeTextMsg('assistant', 'old answer'),
      makeTextMsg('user', 'x'.repeat(80)),
      makeTextMsg('assistant', 'recent answer'),
    ]
    const keepRecentTokens = estimateContextTokens([messages[3]]) + 1
    const plan = planCompaction({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens },
      trigger: 'automatic',
      contextTokens: 9000,
      contextLength: 10_000,
    })

    expect(plan).toEqual({
      eligible: true,
      cutIndex: 2,
      toSummarizeCount: 2,
    })
    if (!plan.eligible) {
      throw new Error('Expected compaction plan to be eligible')
    }
    expect(estimateContextTokens(messages.slice(plan.cutIndex))).toBeGreaterThan(keepRecentTokens)
  })
})

describe('compactMessages 行为', () => {
  const noopAiProvider = {} as IAIProvider

  it('禁用压缩时返回原消息', async () => {
    const messages = [makeTextMsg('user', 'hello')]
    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, enabled: false },
      aiProvider: noopAiProvider,
      model: 'test-model',
      summarize: async () => ({ text: 'summary' }),
    })
    expect(result.compacted).toBe(false)
    expect(result.messages).toBe(messages)
  })

  it('低于阈值时返回原消息', async () => {
    const messages = [makeTextMsg('user', 'hello')]
    const result = await compactMessages({
      messages,
      settings: DEFAULT_COMPACTION_SETTINGS,
      aiProvider: noopAiProvider,
      model: 'test-model',
      contextTokens: 1,
      contextLength: 100,
      summarize: async () => ({ text: 'summary' }),
    })
    expect(result.compacted).toBe(false)
  })

  it('超过阈值且 token 目标外历史足够时执行压缩', async () => {
    const summary = 'This is a summary of previous conversation.'
    const summarize = vi.fn().mockResolvedValue({ text: summary })

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
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 30 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      contextTokens: 100_000,
      contextLength: 128_000,
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

  it('在 token 目标内保留最近消息', async () => {
    const summarize = vi.fn().mockResolvedValue({ text: 'summary' })

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
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 30 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      contextTokens: 100_000,
      contextLength: 128_000,
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

  it('summary 函数抛错时返回原消息', async () => {
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
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 30 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      contextTokens: 100_000,
      contextLength: 128_000,
      summarize,
    })

    expect(result.compacted).toBe(false)
    expect(result.messages).toBe(messages)
  })

  it('找不到安全切点时返回原消息', async () => {
    const summarize = vi.fn().mockResolvedValue({ text: 'summary' })

    // Only 1 user message, need to keep 3 pairs
    const messages = [
      makeTextMsg('user', 'Only question'),
      makeTextMsg('assistant', 'Only answer'),
    ]

    const result = await compactMessages({
      messages,
      settings: { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 30 },
      aiProvider: noopAiProvider,
      model: 'test-model',
      contextTokens: 100_000,
      contextLength: 128_000,
      summarize,
    })

    expect(result.compacted).toBe(false)
  })
})
