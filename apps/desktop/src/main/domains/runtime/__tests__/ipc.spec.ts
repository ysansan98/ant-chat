import { describe, expect, it, vi } from 'vitest'
import { RuntimeIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  settings: {
    get: vi.fn(async () => ({
      assistantModelId: 'model-1',
      proxySettings: { mode: 'none' },
    })),
  },
  chat: {
    listConversations: vi.fn(async () => ({ data: [], total: 0 })),
  },
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/app-runtime-host/appRuntime', () => ({
  getAppRuntime: () => ({
    chat: mocks.chat,
    settings: mocks.settings,
  }),
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe('runtime ipc', () => {
  it('通过统一 RPC 调用 runtime handler 并返回成功响应', async () => {
    const service = new RuntimeIpcService()
    const response = await service.call('settings.getSettings', undefined)

    expect(response.success).toBe(true)
    if (response.success) {
      expect(response.data.assistantModelId).toBe('model-1')
    }
  })

  it('通过 typed input 调用带参数的 runtime handler', async () => {
    const service = new RuntimeIpcService()
    const response = await service.call('chat.getConversations', { pageIndex: 0, pageSize: 20 })

    expect(response.success).toBe(true)
    expect(mocks.chat.listConversations).toHaveBeenCalledWith(0, 20)
  })

  it('未知 RPC 方法返回错误响应', async () => {
    const service = new RuntimeIpcService()
    const response = await service.call('missing.method' as never, undefined as never)

    expect(response.success).toBe(false)
    if (!response.success) {
      expect(response.msg).toBe('Unknown runtime RPC method: missing.method')
    }
  })
})
