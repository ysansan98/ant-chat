import { describe, expect, it, vi } from 'vitest'
import { ChatIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  updateTitle: vi.fn(),
  chat: {
    createConversationTitle: vi.fn(),
  },
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/app-runtime-host/appRuntime', () => ({
  getAppRuntime: () => ({
    chat: {
      createConversationTitle: mocks.updateTitle,
    },
  }),
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

describe('chat ipc', () => {
  it('createConversationsTitle returns error response when title generation fails', async () => {
    mocks.updateTitle.mockRejectedValueOnce(new Error('No output generated'))

    const service = new ChatIpcService()
    const resp = await service.createConversationsTitle({
      modelId: 'model-1',
      conversationsId: 'conv-1',
    })

    expect(resp.success).toBe(false)
    if (!resp.success) {
      expect(resp.msg).toContain('No output generated')
    }
    expect(mocks.updateTitle).toHaveBeenCalledWith('conv-1', 'model-1')
  })
})
