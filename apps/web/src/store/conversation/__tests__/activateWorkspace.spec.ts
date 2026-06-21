import type { IConversations } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chatMocks = vi.hoisted(() => ({
  getWorkspaceConversations: vi.fn(),
  clearWorkspaceConversations: vi.fn(),
}))

vi.mock('@/api/chatApi', () => ({
  default: chatMocks,
}))

import { useWorkspaceStore } from '@/store/workspace'
import { activateWorkspace, clearConversationsAction } from '../actions'
import { useConversationsStore } from '../conversationsStore'
import { useMessagesStore } from '@/store/messages'

function makeConversation(id: string, workspacePath: string): IConversations {
  return {
    id,
    workspacePath,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    settings: { modelId: 'm', providerId: 'p', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
  } as IConversations
}

describe('activateWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({ currentWorkspacePath: '', workspaceData: null, loading: false })
    useConversationsStore.setState({
      conversations: [],
      abortCallbacks: [],
      pageIndex: 0,
      pageSize: 20,
      conversationsTotal: 1,
      activeConversationsId: 'stale-id',
      streamingConversationIds: new Set<string>(),
      loadVersion: 0,
      workspaceConversations: {},
    })
    useMessagesStore.setState({ activeConversationsId: 'stale-id', messages: [] })
  })

  it('空路径时仅清空 activeConversationsId,不加载会话', async () => {
    await activateWorkspace('')

    expect(useMessagesStore.getState().activeConversationsId).toBe('')
    expect(chatMocks.getWorkspaceConversations).not.toHaveBeenCalled()
  })

  it('非空路径时加载该工作区分片并切换顶层 slice', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '/other' })
    chatMocks.getWorkspaceConversations.mockResolvedValue({
      data: [makeConversation('c1', '/target')],
      total: 1,
    })

    await activateWorkspace('/target')

    expect(chatMocks.getWorkspaceConversations).toHaveBeenCalledWith('/target', 0, 20)
    expect(useConversationsStore.getState().conversations).toHaveLength(1)
    expect(useConversationsStore.getState().conversations[0].id).toBe('c1')
  })

  it('分片已加载时复用缓存,不重复请求', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '/other' })
    // 预置已加载的分片
    useConversationsStore.setState({
      workspaceConversations: {
        '/target': {
          conversations: [makeConversation('cached', '/target')],
          pageIndex: 0,
          conversationsTotal: 1,
          loadVersion: 0,
          loaded: true,
        },
      },
    })

    await activateWorkspace('/target')

    expect(chatMocks.getWorkspaceConversations).not.toHaveBeenCalled()
    expect(useConversationsStore.getState().conversations[0].id).toBe('cached')
  })
})

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
      streamingConversationIds: new Set<string>(),
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
