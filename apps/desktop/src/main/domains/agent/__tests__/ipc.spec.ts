import { describe, expect, it, vi } from 'vitest'

import { AgentIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  startAgentTurn: vi.fn(async () => ({ taskId: 't2', conversationId: 'c1', userMessageId: 'm1', conversation: { id: 'c1' } })),
  runtime: {
    approvePendingAction: vi.fn(),
    rejectPendingAction: vi.fn(),
    cancelTask: vi.fn(),
    getTask: vi.fn(() => ({ taskId: 't1', status: 'running' })),
    listActiveTasks: vi.fn(() => [{ taskId: 't1', status: 'running' }]),
    injectSteering: vi.fn(),
  },
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/agent/runtime/agentRuntimeEnvironment', () => ({
  getAgentRuntimeEnvironment: () => ({
    agentService: {
      startTurn: mocks.startAgentTurn,
      approvePendingActionWithWhitelist: vi.fn(),
    },
    runtime: mocks.runtime,
  }),
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
