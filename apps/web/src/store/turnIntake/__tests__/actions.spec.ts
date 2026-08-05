import type { ConversationsId, IMessage } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentRuntimeStore } from '@/store/agentRuntime'
import { useChatSttingsStore } from '@/store/chatSettings'
import { useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import { usePendingMessagesStore } from '@/store/pendingMessages'
import { useWorkspaceStore } from '@/store/workspace'
import { submitTurnIntake } from '../actions'

const mocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getMessagesByConvId: vi.fn(),
  injectSteering: vi.fn(),
  listActiveTasks: vi.fn(),
  runBuiltinCommand: vi.fn(),
  startTurn: vi.fn(),
}))

vi.mock('@/api/agentApi', () => ({ default: {
  injectSteering: mocks.injectSteering,
  listActiveTasks: mocks.listActiveTasks,
  startTurn: mocks.startTurn,
} }))
vi.mock('@/api/chatApi', () => ({ default: {
  getConversationById: mocks.getConversationById,
  getMessagesByConvId: mocks.getMessagesByConvId,
} }))
vi.mock('@/api/commandsApi', () => ({ default: {
  runBuiltinCommand: mocks.runBuiltinCommand,
} }))

const conversation = {
  id: 'conv-1',
  title: '会话',
  workspacePath: '/workspace',
  createdAt: 1,
  updatedAt: 1,
  settings: {
    modelId: 'model-1',
    providerId: 'provider-1',
  },
}

describe('submitTurnIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentRuntimeStore.setState({
      tasks: {},
      executionPhaseByTurn: {},
      pendingByTask: {},
      secretRequests: {},
    })
    useConversationsStore.getState().reset()
    useMessagesStore.getState().reset()
    usePendingMessagesStore.setState({ itemsByConversation: {} })
    useWorkspaceStore.setState({ currentWorkspacePath: '/workspace', workspaceData: null, loading: false })
    useChatSttingsStore.setState({ agentMode: 'hybrid' })
    mocks.getMessagesByConvId.mockResolvedValue([createMessage('user-1', 'conv-1')])
    mocks.getConversationById.mockResolvedValue(conversation)
    mocks.listActiveTasks.mockResolvedValue([])
    mocks.startTurn.mockResolvedValue({
      conversation,
      conversationId: 'conv-1',
      taskId: 'task-1',
      userMessageId: 'user-1',
    })
  })

  it('普通轮次统一组装输入并完成会话、消息和 runtime 投影对账', async () => {
    mocks.listActiveTasks.mockResolvedValueOnce([{
      conversationId: 'conv-1',
      taskId: 'task-1',
      userMessageId: 'user-1',
      status: 'running',
    }])

    const result = await submitTurnIntake({
      origin: 'chat',
      conversationId: '',
      messageContent: [{ type: 'text', text: '开始实现' }],
      mode: 'hybrid',
      workspacePath: '/workspace',
      settings: conversation.settings,
      conversationInstructions: '使用中文',
    })

    expect(result.kind).toBe('regular')
    expect(mocks.startTurn).toHaveBeenCalledWith({
      conversationId: undefined,
      messageContent: [{ type: 'text', text: '开始实现' }],
      mode: 'hybrid',
      workspacePath: '/workspace',
      conversationInstructions: '使用中文',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        reasoningEffort: undefined,
      },
    })
    expect(useMessagesStore.getState().activeConversationsId).toBe('conv-1')
    expect(useMessagesStore.getState().messages).toEqual([createMessage('user-1', 'conv-1')])
    expect(useConversationsStore.getState().conversationStates['conv-1']).toBe('running')
  })

  it('聊天入口在任务运行中归类为 steering 并进入待处理队列', async () => {
    mocks.listActiveTasks.mockResolvedValue([{
      conversationId: 'conv-1',
      taskId: 'task-1',
      userMessageId: 'user-1',
      status: 'running',
    }])

    const result = await submitTurnIntake({
      origin: 'chat',
      conversationId: 'conv-1',
      messageContent: [{ type: 'text', text: '调整实现' }],
      mode: 'hybrid',
      workspacePath: '/workspace',
      settings: conversation.settings,
    })

    expect(result.kind).toBe('steering')
    expect(mocks.startTurn).not.toHaveBeenCalled()
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toEqual([
      expect.objectContaining({ text: '调整实现', delivery: 'steering', source: 'sender' }),
    ])
  })

  it('turn 已提交后投影失败仍返回成功，避免用户重试产生重复轮次', async () => {
    mocks.getMessagesByConvId.mockRejectedValueOnce(new Error('消息加载失败'))

    const result = await submitTurnIntake({
      origin: 'chat',
      conversationId: '',
      messageContent: [{ type: 'text', text: '开始实现' }],
      mode: 'hybrid',
      workspacePath: '/workspace',
      settings: conversation.settings,
    })

    expect(result).toEqual({
      kind: 'regular',
      conversationId: 'conv-1',
      projectionWarning: '操作已完成，但会话状态同步失败，请稍后重新打开会话',
    })
    expect(mocks.startTurn).toHaveBeenCalledTimes(1)
    expect(useMessagesStore.getState().activeConversationsId).toBe('conv-1')
  })

  it('可视化入口在任务运行中始终归类为 next-turn', async () => {
    mocks.listActiveTasks.mockResolvedValue([{
      conversationId: 'conv-1',
      taskId: 'task-1',
      userMessageId: 'user-1',
      status: 'running',
    }])

    const result = await submitTurnIntake({
      origin: 'visualization',
      conversationId: 'conv-1',
      messageContent: [{ type: 'text', text: '姓名：张三' }],
      mode: 'hybrid',
      workspacePath: '/workspace',
      settings: conversation.settings,
    })

    expect(result.kind).toBe('next-turn')
    expect(mocks.injectSteering).not.toHaveBeenCalled()
    expect(mocks.startTurn).not.toHaveBeenCalled()
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toEqual([
      expect.objectContaining({ text: '姓名：张三', delivery: 'next-turn', source: 'visualization' }),
    ])
  })

  it('内置命令由 intake 分类并完成命令结果投影', async () => {
    mocks.runBuiltinCommand.mockResolvedValue({ status: 'success', conversation })

    const result = await submitTurnIntake({
      origin: 'chat',
      conversationId: '',
      messageContent: [{ type: 'text', text: '/new' }],
      mode: 'hybrid',
      workspacePath: '/workspace',
      settings: conversation.settings,
      conversationInstructions: '使用中文',
    })

    expect(result.kind).toBe('command')
    expect(mocks.runBuiltinCommand).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new',
      conversationInstructions: '使用中文',
    }))
    expect(mocks.startTurn).not.toHaveBeenCalled()
    expect(useMessagesStore.getState().activeConversationsId).toBe('conv-1')
  })

  it('/new 已成功后投影失败不抛错，避免重复创建会话', async () => {
    mocks.runBuiltinCommand.mockResolvedValue({ status: 'success', conversation })
    mocks.getMessagesByConvId.mockRejectedValueOnce(new Error('消息加载失败'))

    const result = await submitTurnIntake({
      origin: 'chat',
      conversationId: '',
      messageContent: [{ type: 'text', text: '/new' }],
      mode: 'hybrid',
      workspacePath: '/workspace',
      settings: conversation.settings,
    })

    expect(result.projectionWarning).toBe('操作已完成，但会话状态同步失败，请稍后重新打开会话')
    expect(mocks.runBuiltinCommand).toHaveBeenCalledOnce()
    expect(useMessagesStore.getState().activeConversationsId).toBe('conv-1')
  })

  it('/compact 已成功后读取投影失败不抛错，避免重复压缩', async () => {
    mocks.runBuiltinCommand.mockResolvedValue({ status: 'success' })
    mocks.getConversationById.mockRejectedValueOnce(new Error('会话读取失败'))

    const result = await submitTurnIntake({
      origin: 'chat',
      conversationId: 'conv-1',
      messageContent: [{ type: 'text', text: '/compact' }],
      mode: 'hybrid',
      workspacePath: '/workspace',
      settings: conversation.settings,
    })

    expect(result.projectionWarning).toBe('操作已完成，但会话状态同步失败，请稍后重新打开会话')
    expect(mocks.runBuiltinCommand).toHaveBeenCalledOnce()
  })
})

function createMessage(id: string, conversationId: string): IMessage {
  return {
    id,
    convId: conversationId as ConversationsId,
    createdAt: 1,
    role: 'user',
    status: 'success',
    content: [{ type: 'text', text: '开始实现' }],
    turnId: 'turn-1',
  }
}
