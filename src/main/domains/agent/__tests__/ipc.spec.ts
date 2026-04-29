import { describe, expect, it, vi } from 'vitest'

import { AgentIpcService } from '../ipc'

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/agent/runtime/agentRuntime', () => ({
  agentRuntime: {
    startTask: vi.fn(async () => ({ taskId: 't1' })),
    approvePendingAction: vi.fn(async () => {}),
    rejectPendingAction: vi.fn(async () => {}),
    cancelTask: vi.fn(async () => {}),
    getTask: vi.fn(() => ({ taskId: 't1', status: 'running' })),
    listActiveTasks: vi.fn(() => [{ taskId: 't1', status: 'running' }]),
  },
}))

describe('agent ipc', () => {
  it('startTask 返回成功响应', async () => {
    const service = new AgentIpcService()
    const resp = await service.startTask({ conversationId: 'c1', userMessageId: 'm1', prompt: 'p' })
    expect(resp.success).toBe(true)
    if (resp.success) {
      expect(resp.data.taskId).toBe('t1')
    }
  })

  it('approve/reject/cancel/get/list 正常响应', async () => {
    const service = new AgentIpcService()
    expect((await service.approvePendingAction({ taskId: 't1', actionId: 'a1' })).success).toBe(true)
    expect((await service.rejectPendingAction({ taskId: 't1', actionId: 'a1' })).success).toBe(true)
    expect((await service.cancelTask({ taskId: 't1' })).success).toBe(true)
    expect((await service.getTask('t1')).success).toBe(true)
    expect((await service.listActiveTasks('c1')).success).toBe(true)
  })
})
