import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (method: string, input: unknown) => {
    if (method === 'settings.getSettings') {
      return {
        assistantModelId: 'model-1',
        proxySettings: { mode: 'none' },
      }
    }
    if (method === 'chat.getConversations') {
      return { data: [], total: 0, input }
    }
    throw new Error(`运行时路由不存在: ${method}`)
  }),
  isShuttingDown: vi.fn(() => false),
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/app-runtime-host/appRuntime', () => ({
  getAppRuntime: () => ({
    invoke: mocks.invoke,
  }),
  isDesktopAppRuntimeShuttingDown: () => mocks.isShuttingDown(),
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe('runtime ipc', () => {
  beforeEach(() => {
    mocks.invoke.mockClear()
    mocks.isShuttingDown.mockReturnValue(false)
  })

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
    expect(mocks.invoke).toHaveBeenCalledWith('chat.getConversations', { pageIndex: 0, pageSize: 20 })
  })

  it('未知 RPC 方法在 main 被拒绝，且不调用 runtime', async () => {
    const service = new RuntimeIpcService()
    const response = await service.call('missing.method' as never, undefined as never)

    expect(response.success).toBe(false)
    if (!response.success) {
      expect(response.msg).toBe('未知的 Runtime RPC 方法: missing.method')
    }
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('非对象 input 在 main 被拒绝，且不调用 runtime', async () => {
    const service = new RuntimeIpcService()

    for (const input of ['not-an-object', 42, null, ['array']]) {
      const response = await service.call('chat.getConversations', input as never)
      expect(response.success).toBe(false)
      if (!response.success) {
        expect(response.msg).toBe('runtime.call 的 input 必须是对象或 undefined')
      }
    }

    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('应用退出过程中 RPC 失败不记 error 日志（关闭噪音静默）', async () => {
    const { logger } = await import('@main/utils/logger')
    ;(logger.error as ReturnType<typeof vi.fn>).mockClear()
    mocks.isShuttingDown.mockReturnValue(true)
    const service = new RuntimeIpcService()

    const response = await service.call('search.searchByKeyword', { query: 'x' })

    expect(response.success).toBe(false)
    expect(logger.error).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('search.searchByKeyword', { query: 'x' })
  })
})
