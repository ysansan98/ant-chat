import { describe, expect, it, vi } from 'vitest'

import { approveAgentAction, cancelAgentTask, rejectAgentAction, startAgentTask } from '../actions'

vi.mock('@/api/agentApi', () => ({
  default: {
    startTask: vi.fn(async () => ({ taskId: 't1' })),
    approvePendingAction: vi.fn(async () => null),
    rejectPendingAction: vi.fn(async () => null),
    cancelTask: vi.fn(async () => null),
  },
}))

describe('agent store actions', () => {
  it('调用 agent api', async () => {
    const created = await startAgentTask({ conversationId: 'c1', userMessageId: 'm1', prompt: 'p' })
    expect(created.taskId).toBe('t1')
    await expect(approveAgentAction({ taskId: 't1', actionId: 'a1' })).resolves.toBeUndefined()
    await expect(rejectAgentAction({ taskId: 't1', actionId: 'a1', reason: 'r' })).resolves.toBeUndefined()
    await expect(cancelAgentTask('t1')).resolves.toBeUndefined()
  })
})
