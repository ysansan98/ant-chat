import { describe, expect, it, vi } from 'vitest'
import { ChatIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  handleInitConversationTitle: vi.fn(),
  conversationService: {
    update: vi.fn(),
  },
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/ai-providers/services/conversation-title-service', () => ({
  handleInitConversationTitle: mocks.handleInitConversationTitle,
}))

vi.mock('@main/adapters/appDataContainer', () => ({
  getAppDataServices: () => ({
    conversationService: mocks.conversationService,
    messageService: {},
  }),
}))

vi.mock('@main/store/workspace', () => ({
  WorkspaceStore: {
    getInstance: () => ({
      getCurrentWorkspacePath: () => '/workspace',
      getDefaultWorkspacePath: () => '/workspace',
    }),
  },
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
