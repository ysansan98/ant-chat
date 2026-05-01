import { describe, expect, it, vi } from 'vitest'

import { approveAgentAction, cancelAgentTask, rejectAgentAction, startAgentTurn } from '../actions'

vi.mock('@/api/agentApi', () => ({
  default: {
    startTurn: vi.fn(async () => ({ taskId: 't1', conversationId: 'c1', userMessageId: 'm1', conversation: { id: 'c1' } })),
    approvePendingAction: vi.fn(async () => null),
    rejectPendingAction: vi.fn(async () => null),
    cancelTask: vi.fn(async () => null),
  },
}))

describe('agent store actions', () => {
  it('调用 agent api', async () => {
    const created = await startAgentTurn({
      prompt: 'p',
      chatSettings: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
        features: {
          onlineSearch: false,
          enableMCP: false,
        },
      },
    })
    expect(created.taskId).toBe('t1')
    await expect(approveAgentAction({ taskId: 't1', actionId: 'a1' })).resolves.toBeUndefined()
    await expect(rejectAgentAction({ taskId: 't1', actionId: 'a1', reason: 'r' })).resolves.toBeUndefined()
    await expect(cancelAgentTask('t1')).resolves.toBeUndefined()
  })
})
