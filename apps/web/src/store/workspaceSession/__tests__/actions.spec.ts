import type { ConversationsId, IConversations, IMessage, ListWorkspacesData } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentRuntimeStore } from '@/store/agentRuntime'
import { useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
import { activateWorkspaceSession } from '../actions'

const mocks = vi.hoisted(() => ({
  getMessagesByConvId: vi.fn(),
  getWorkspaceConversations: vi.fn(),
  listActiveTasks: vi.fn(),
  openWorkspace: vi.fn(),
}))

vi.mock('@/api/agentApi', () => ({ default: {
  listActiveTasks: mocks.listActiveTasks,
} }))
vi.mock('@/api/chatApi', () => ({ default: {
  getMessagesByConvId: mocks.getMessagesByConvId,
  getWorkspaceConversations: mocks.getWorkspaceConversations,
} }))
vi.mock('@/api/workspaceApi', () => ({ default: {
  openWorkspace: mocks.openWorkspace,
} }))

describe('activateWorkspaceSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({
      currentWorkspacePath: '/old',
      workspaceData: makeWorkspaces('/old', '/target'),
      loading: false,
    })
    useConversationsStore.setState({
      conversations: [makeConversation('old-conv', '/old')],
      abortCallbacks: [],
      pageIndex: 0,
      pageSize: 20,
      conversationsTotal: 1,
      activeConversationsId: 'old-conv',
      activeWorkspacePath: '/old',
      conversationStates: {},
      loadVersion: 0,
      workspaceConversations: {},
    })
    useMessagesStore.setState({
      activeConversationsId: 'old-conv' as ConversationsId,
      messages: [makeMessage('old-message', 'old-conv')],
      pendingSteeringByConversation: {},
    })
    useAgentRuntimeStore.setState({
      tasks: {
        'old-task': {
          conversationId: 'old-conv',
          taskId: 'old-task',
          userMessageId: 'old-message',
          workspacePath: '/old',
          mode: 'hybrid',
          status: 'running',
          createdAt: 1,
          updatedAt: 1,
          prompt: '旧任务',
        },
      },
      executionPhaseByTurn: { 'old-message': 'waiting_model' },
      pendingByTask: {},
      secretRequests: {},
    })
    mocks.openWorkspace.mockResolvedValue(makeWorkspaces('/old', '/target'))
    mocks.getWorkspaceConversations.mockResolvedValue({
      data: [makeConversation('target-conv', '/target')],
      total: 1,
    })
    mocks.getMessagesByConvId.mockResolvedValue([makeMessage('target-message', 'target-conv')])
    mocks.listActiveTasks.mockResolvedValue([])
  })

  it('一次调用完成工作区持久化、slice 切换、消息加载和 runtime 对账', async () => {
    await activateWorkspaceSession({ workspacePath: '/target', conversationId: 'target-conv' })

    expect(mocks.openWorkspace).toHaveBeenCalledWith('/target')
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/target')
    expect(useConversationsStore.getState().activeWorkspacePath).toBe('/target')
    expect(useConversationsStore.getState().conversations.map(item => item.id)).toEqual(['target-conv'])
    expect(useMessagesStore.getState().activeConversationsId).toBe('target-conv')
    expect(useMessagesStore.getState().messages.map(item => item.id)).toEqual(['target-message'])
    expect(mocks.listActiveTasks).toHaveBeenCalledWith('target-conv')
  })

  it('任一步骤失败时恢复工作区、conversation、messages 和 runtime 投影', async () => {
    mocks.listActiveTasks.mockImplementationOnce(async () => {
      useAgentRuntimeStore.getState().setTask({
        conversationId: 'unrelated-conv',
        taskId: 'unrelated-task',
        userMessageId: 'unrelated-message',
        workspacePath: '/other',
        mode: 'hybrid',
        status: 'running',
        createdAt: 2,
        updatedAt: 2,
        prompt: '无关任务',
      })
      useConversationsStore.setState(state => ({
        conversationStates: { ...state.conversationStates, 'unrelated-conv': 'running' },
      }))
      return [{
        conversationId: 'target-conv',
        taskId: 'target-task',
        userMessageId: 'target-message',
        status: 'running',
      }]
    })
    mocks.getMessagesByConvId.mockRejectedValueOnce(new Error('消息加载失败'))

    await expect(activateWorkspaceSession({
      workspacePath: '/target',
      conversationId: 'target-conv',
    })).rejects.toThrow('消息加载失败')

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/old')
    expect(useConversationsStore.getState().activeWorkspacePath).toBe('/old')
    expect(useConversationsStore.getState().conversations.map(item => item.id)).toEqual(['old-conv'])
    expect(useMessagesStore.getState().activeConversationsId).toBe('old-conv')
    expect(useMessagesStore.getState().messages.map(item => item.id)).toEqual(['old-message'])
    expect(Object.keys(useAgentRuntimeStore.getState().tasks).sort()).toEqual(['old-task', 'unrelated-task'])
    expect(useAgentRuntimeStore.getState().executionPhaseByTurn).toEqual({
      'old-message': 'waiting_model',
      'unrelated-message': 'waiting_model',
    })
    expect(useConversationsStore.getState().conversationStates['unrelated-conv']).toBe('running')
  })
})

function makeWorkspaces(...paths: string[]): ListWorkspacesData {
  return {
    workspaces: paths.map((path, index) => ({
      path,
      displayName: path,
      isDefault: index === 0,
      lastOpenedAt: index + 1,
    })),
  }
}

function makeConversation(id: string, workspacePath: string): IConversations {
  return {
    id,
    workspacePath,
    title: id,
    createdAt: 1,
    updatedAt: 1,
  } as IConversations
}

function makeMessage(id: string, conversationId: string): IMessage {
  return {
    id,
    convId: conversationId as ConversationsId,
    createdAt: 1,
    role: 'user',
    status: 'success',
    content: [{ type: 'text', text: id }],
    turnId: 'turn-1',
  }
}
