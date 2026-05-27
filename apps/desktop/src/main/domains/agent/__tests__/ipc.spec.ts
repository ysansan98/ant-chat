import { describe, expect, it, vi } from 'vitest'

import { AgentIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  startAgentTurn: vi.fn(async () => ({ taskId: 't2', conversationId: 'c1', userMessageId: 'm1', conversation: { id: 'c1' } })),
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/agent/runtime/agentTurnService', () => ({
  agentRuntime: {
    approvePendingAction: vi.fn(async () => {}),
    rejectPendingAction: vi.fn(async () => {}),
    cancelTask: vi.fn(async () => {}),
    getTask: vi.fn(() => ({ taskId: 't1', status: 'running' })),
    listActiveTasks: vi.fn(() => [{ taskId: 't1', status: 'running' }]),
  },
  startAgentTurn: mocks.startAgentTurn,
}))

describe('agent ipc', () => {
  it('startTurn 返回成功响应', async () => {
    const service = new AgentIpcService()
    const resp = await service.startTurn({
      prompt: 'p',
      modelConfig: {
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
    expect(resp.success).toBe(true)
    if (resp.success) {
      expect(resp.data.taskId).toBe('t2')
      expect(resp.data.conversationId).toBe('c1')
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
