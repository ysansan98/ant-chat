import { describe, expect, it, vi } from 'vitest'
import { ChatIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  updateTitle: vi.fn(),
  conversationRepository: {
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

vi.mock('@ant-chat/agent-runtime', () => ({
  createConversationTitleGenerator: vi.fn(() => ({
    updateTitle: mocks.updateTitle,
  })),
}))

vi.mock('@main/agent/runtime/agentRuntimeEnvironment', () => ({
  getAgentRuntimeEnvironment: () => ({
    appDataContext: {
      conversationRepository: mocks.conversationRepository,
      messageRepository: {},
      workspaceService: mocks.workspaceService,
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
    expect(mocks.conversationRepository.update).not.toHaveBeenCalled()
  })
})
