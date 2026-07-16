import type { IConversations } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceStore } from '@/store/workspace'
import { clearConversationsAction } from '../actions'
import { useConversationsStore } from '../conversationsStore'

const chatMocks = vi.hoisted(() => ({
  getWorkspaceConversations: vi.fn(),
  clearWorkspaceConversations: vi.fn(),
}))

vi.mock('@/api/chatApi', () => ({
  default: chatMocks,
}))

function makeConversation(id: string, workspacePath: string): IConversations {
  return {
    id,
    workspacePath,
    title: id,
    createdAt: 1,
    updatedAt: 1,
  } as IConversations
}

describe('clearConversationsAction 跨 store 取路径', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({ currentWorkspacePath: '/cur', workspaceData: null, loading: false })
    useConversationsStore.setState({
      conversations: [makeConversation('c1', '/cur')],
      abortCallbacks: [],
      pageIndex: 0,
      pageSize: 20,
      conversationsTotal: 1,
      activeConversationsId: '',
      conversationStates: {},
      loadVersion: 0,
      workspaceConversations: {},
    })
  })

  it('用 workspaceStore 当前路径清空,不再读 conversationsStore.currentWorkspacePath', async () => {
    chatMocks.clearWorkspaceConversations.mockResolvedValue([])

    await clearConversationsAction()

    expect(chatMocks.clearWorkspaceConversations).toHaveBeenCalledWith('/cur')
  })

  it('workspaceStore 路径为空时抛错', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '' })

    await expect(clearConversationsAction()).rejects.toThrow('当前工作区路径不存在，无法清空对话')
  })
})
