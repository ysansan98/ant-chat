import { describe, expect, it, vi } from 'vitest'
import { ChatIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  handleInitConversationTitle: vi.fn(),
  conversationService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  workspaceService: {
    getCurrentWorkspacePath: vi.fn(() => '/workspace'),
    getDefaultWorkspacePath: vi.fn(() => '/workspace'),
  },
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('../conversationTitleService', () => ({
  handleInitConversationTitle: mocks.handleInitConversationTitle,
}))

vi.mock('@main/adapters/appDataContainer', () => ({
  getAppDataServices: () => ({
    conversationService: mocks.conversationService,
    messageService: {},
    workspaceService: mocks.workspaceService,
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
    mocks.handleInitConversationTitle.mockRejectedValueOnce(new Error('No output generated'))

    const service = new ChatIpcService()
    const resp = await service.createConversationsTitle({
      modelId: 'model-1',
      conversationsId: 'conv-1',
    })

    expect(resp.success).toBe(false)
    if (!resp.success) {
      expect(resp.msg).toContain('No output generated')
    }
    expect(mocks.conversationService.update).not.toHaveBeenCalled()
  })
})
