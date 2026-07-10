import { describe, expect, it, vi } from 'vitest'
import { createCompactionStrategy } from '../compactionStrategy'
import type { IAIProvider } from '@ant-chat/shared'

describe('createCompactionStrategy 推理强度透传', () => {
  it('将 reasoningEffort 透传到 complete 的 modelSettings', async () => {
    const complete = vi.fn<IAIProvider['complete']>(async () => ({ text: 'summary' }))
    const aiProvider = { complete } as unknown as IAIProvider

    await createCompactionStrategy('high').summarize('history', aiProvider, 'model-x')

    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][0].modelSettings.reasoningEffort).toBe('high')
  })

  it('未设置 reasoningEffort 时不传该字段', async () => {
    const complete = vi.fn<IAIProvider['complete']>(async () => ({ text: 'summary' }))
    const aiProvider = { complete } as unknown as IAIProvider

    await createCompactionStrategy().summarize('history', aiProvider, 'model-x')

    expect(complete.mock.calls[0][0].modelSettings.reasoningEffort).toBeUndefined()
  })
})
