import type { IConversations } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
import { archiveConversationAction, restoreConversationAction } from '../actions'
import { useConversationsStore } from '../conversationsStore'

const mocks = vi.hoisted(() => ({
  archiveConversation: vi.fn(),
  getWorkspaceConversations: vi.fn(),
  restoreConversation: vi.fn(),
}))

vi.mock('@/api/chatApi', () => ({ default: mocks }))

function conversation(id: string, updatedAt: number, archived = false): IConversations {
  return {
    id,
    title: id,
    workspacePath: '/workspace',
    conversationInstructions: '',
    createdAt: updatedAt,
    updatedAt,
    archived,
    settings: {
      modelId: '',
      providerId: '',
    },
  }
}

describe('会话归档状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({ currentWorkspacePath: '/workspace', workspaceData: null, loading: false })
    useMessagesStore.setState({ activeConversationsId: 'c1', messages: [], pendingSteeringByConversation: {} })
    const conversations = [conversation('c1', 5), conversation('c2', 4), conversation('c3', 3), conversation('c4', 2), conversation('c5', 1)]
    useConversationsStore.setState({
      conversations,
      conversationsTotal: { '/workspace': 6 },
      conversationStates: {},
    })
  })

  it('归档当前会话后清空活动状态并补足五条预览', async () => {
    mocks.archiveConversation.mockResolvedValue(conversation('c1', 5, true))
    mocks.getWorkspaceConversations.mockResolvedValue({
      data: [conversation('c2', 4), conversation('c3', 3), conversation('c4', 2), conversation('c5', 1), conversation('c6', 0)],
      total: 5,
    })

    const result = await archiveConversationAction('c1')

    expect(result.wasActive).toBe(true)
    expect(useMessagesStore.getState().activeConversationsId).toBe('')
    expect(useConversationsStore.getState().conversations.map(item => item.id)).toEqual(['c2', 'c3', 'c4', 'c5', 'c6'])
    expect(useConversationsStore.getState().conversationsTotal['/workspace']).toBe(5)
  })

  it('取消归档增加对应工作区总数', async () => {
    const restored = conversation('old', 0, false)
    mocks.restoreConversation.mockResolvedValue(restored)
    useConversationsStore.setState(state => ({ ...state, conversationsTotal: { '/workspace': 5 } }))

    await restoreConversationAction('old')

    expect(useConversationsStore.getState().conversationsTotal['/workspace']).toBe(6)
  })

  it('取消归档按原更新时间插回原工作区，不会置顶旧会话', async () => {
    const restored = conversation('old', 0, false)
    mocks.restoreConversation.mockResolvedValue(restored)

    await restoreConversationAction('old')

    expect(useConversationsStore.getState().conversations.map(item => item.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'old'])
    expect(useMessagesStore.getState().activeConversationsId).toBe('c1')
  })
})
