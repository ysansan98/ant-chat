import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatSttingsStore } from '@/store/chatSettings'
import { clearConversationsAction, deleteConversationsAction, useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
import { cancelPendingMessageDeletion, clearAllPendingMessages, completePendingMessageDeletion, drainPendingMessages, enqueuePendingMessage, enqueueVisualizationNextTurn, getPendingMessageOperationStateForTests, injectPendingMessage, preparePendingMessageDeletion, submitVisualizationFollowUp } from '../actions'
import { usePendingMessagesStore } from '../store'

const mocks = vi.hoisted(() => ({
  injectSteering: vi.fn(),
  listActiveTasks: vi.fn(),
  startTurn: vi.fn(),
  clearWorkspaceConversations: vi.fn(),
  deleteConversation: vi.fn(),
  getMessagesByConvId: vi.fn(),
}))

vi.mock('@/api/agentApi', () => ({ default: mocks }))
vi.mock('@/api/chatApi', () => ({
  default: {
    clearWorkspaceConversations: mocks.clearWorkspaceConversations,
    deleteConversation: mocks.deleteConversation,
    getMessagesByConvId: mocks.getMessagesByConvId,
  },
}))

const conversation = {
  id: 'conv-1',
  title: '测试会话',
  workspacePath: '/workspace',
  conversationInstructions: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  settings: {
    modelId: 'test-model',
    providerId: 'test-provider',
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
}

describe('pending message actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePendingMessagesStore.setState({ itemsByConversation: {} })
    useConversationsStore.setState({ conversations: [conversation], activeWorkspacePath: '/workspace' })
    useMessagesStore.setState({ activeConversationsId: 'conv-1', messages: [], pendingSteeringByConversation: {} })
    useWorkspaceStore.setState({ currentWorkspacePath: '/workspace' })
    useChatSttingsStore.setState({ agentMode: 'hybrid' })
    mocks.listActiveTasks.mockResolvedValue([])
    mocks.clearWorkspaceConversations.mockResolvedValue(['conv-1'])
    mocks.deleteConversation.mockResolvedValue(null)
    mocks.getMessagesByConvId.mockResolvedValue([])
    mocks.startTurn.mockResolvedValue({ conversation, conversationId: 'conv-1', taskId: 'task-2', userMessageId: 'user-2' })
  })

  it('重复 drain 只启动一个 FIFO 队首且不会连续发送第二项', async () => {
    enqueuePendingMessage('conv-1', '第一条')
    enqueuePendingMessage('conv-1', '第二条')
    const one = drainPendingMessages('conv-1')
    const two = drainPendingMessages('conv-1')
    expect(one).toBe(two)
    await Promise.all([one, two])
    expect(mocks.startTurn).toHaveBeenCalledTimes(1)
    expect(mocks.startTurn).toHaveBeenCalledWith(expect.objectContaining({ messageContent: [{ type: 'text', text: '第一条' }], workspacePath: '/workspace' }))
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toHaveLength(1)
  })

  it('立即追加成功后删除队列项', async () => {
    const queued = enqueuePendingMessage('conv-1', '追加内容')
    mocks.listActiveTasks.mockResolvedValue([{ conversationId: 'conv-1', taskId: 'task-1', status: 'running' }])
    mocks.injectSteering.mockResolvedValue({ id: 'message-1', convId: 'conv-1', role: 'user', status: 'success', content: [{ type: 'text', text: '追加内容' }] })
    await injectPendingMessage('conv-1', queued.id)
    expect(mocks.injectSteering).toHaveBeenCalledWith('conv-1', '追加内容')
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toEqual([])
  })

  it('可视化 next-turn 在运行中只入队且不会调用 steering', async () => {
    mocks.listActiveTasks.mockResolvedValue([{ conversationId: 'conv-1', taskId: 'task-1', status: 'running' }])
    await submitVisualizationFollowUp('conv-1', '请分析表单结果')

    expect(mocks.injectSteering).not.toHaveBeenCalled()
    expect(mocks.startTurn).not.toHaveBeenCalled()
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toEqual([
      expect.objectContaining({ text: '请分析表单结果', delivery: 'next-turn', source: 'visualization' }),
    ])
  })

  it('可视化 next-turn 在空闲时直接创建独立 user turn', async () => {
    await submitVisualizationFollowUp('conv-1', '姓名：张三')

    expect(mocks.injectSteering).not.toHaveBeenCalled()
    expect(mocks.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      messageContent: [{ type: 'text', text: '姓名：张三' }],
    }))
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toBeUndefined()
  })

  it('next-turn 队列项被手动点击时也不会注入当前任务', async () => {
    const queued = enqueueVisualizationNextTurn('conv-1', '排队消息')
    mocks.listActiveTasks.mockResolvedValue([{ conversationId: 'conv-1', taskId: 'task-1', status: 'running' }])
    await injectPendingMessage('conv-1', queued.id)

    expect(mocks.injectSteering).not.toHaveBeenCalled()
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toHaveLength(1)
  })

  it('任务已结束时注入回退为普通 turn，失败时保留消息', async () => {
    const queued = enqueuePendingMessage('conv-1', '下一轮')
    mocks.startTurn.mockRejectedValue(new Error('网络不可用'))
    await injectPendingMessage('conv-1', queued.id)
    expect(mocks.injectSteering).not.toHaveBeenCalled()
    // 失败后消息应保留在队列中，让用户决定重试还是手动删除
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toHaveLength(1)
  })

  it('drain 与立即追加并发时按会话串行', async () => {
    enqueuePendingMessage('conv-1', '队首')
    const second = enqueuePendingMessage('conv-1', '队尾')

    const draining = drainPendingMessages('conv-1')
    const injecting = injectPendingMessage('conv-1', second.id)
    await Promise.all([draining, injecting])

    // drainOnce 不再检查 activeTask，直接 startTurn 处理队首
    // inject 因无 active task 回退为 drainOnce，处理队尾
    // 两者通过 runConversationOperation 串行化
    expect(mocks.startTurn).toHaveBeenCalledTimes(2)
    expect(mocks.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ messageContent: [{ type: 'text', text: '队首' }] }))
    expect(mocks.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({ messageContent: [{ type: 'text', text: '队尾' }] }))
    expect(mocks.injectSteering).not.toHaveBeenCalled()
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toHaveLength(0)
  })

  it('清空全部队列不依赖当前已加载会话分页', () => {
    enqueuePendingMessage('conv-1', '当前页')
    enqueuePendingMessage('conv-unloaded', '未加载页')
    clearAllPendingMessages()
    expect(usePendingMessagesStore.getState().itemsByConversation).toEqual({})
  })

  it('单删会等待进行中的 drain 完成，再删除会话和队列', async () => {
    enqueuePendingMessage('conv-1', '正在启动')
    let resolveStart!: (value: any) => void
    mocks.startTurn.mockReturnValue(new Promise((resolve) => {
      resolveStart = resolve
    }))

    const draining = drainPendingMessages('conv-1')
    await vi.waitFor(() => expect(mocks.startTurn).toHaveBeenCalledTimes(1))
    const deleting = deleteConversationsAction('conv-1')
    expect(mocks.deleteConversation).not.toHaveBeenCalled()
    resolveStart({ conversation, conversationId: 'conv-1', taskId: 'task', userMessageId: 'user' })
    await draining
    await deleting

    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toBeUndefined()
    expect(useConversationsStore.getState().conversations.some(item => item.id === 'conv-1')).toBe(false)
  })

  it('清空工作区等待进行中 turn 完成，且只清服务端返回 ID', async () => {
    enqueuePendingMessage('conv-1', '当前工作区')
    enqueuePendingMessage('other-workspace-conv', '其他工作区')
    let resolveStart!: (value: any) => void
    mocks.startTurn.mockReturnValue(new Promise((resolve) => {
      resolveStart = resolve
    }))

    const draining = drainPendingMessages('conv-1')
    await vi.waitFor(() => expect(mocks.startTurn).toHaveBeenCalledTimes(1))
    const clearing = clearConversationsAction()
    expect(mocks.clearWorkspaceConversations).not.toHaveBeenCalled()
    resolveStart({ conversation, conversationId: 'conv-1', taskId: 'task', userMessageId: 'user' })
    await draining
    await clearing

    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toBeUndefined()
    expect(usePendingMessagesStore.getState().itemsByConversation['other-workspace-conv']).toHaveLength(1)
    expect(useConversationsStore.getState().conversations.some(item => item.id === 'conv-1')).toBe(false)
  })

  it('startTurn 已发起时删除失败，保留真实成功结果且不会重复发送', async () => {
    enqueuePendingMessage('conv-1', '已成功启动')
    let resolveStart!: (value: any) => void
    mocks.startTurn.mockReturnValue(new Promise((resolve) => {
      resolveStart = resolve
    }))
    mocks.deleteConversation.mockRejectedValueOnce(new Error('删除失败'))

    const draining = drainPendingMessages('conv-1')
    await vi.waitFor(() => expect(mocks.startTurn).toHaveBeenCalledTimes(1))
    const deleting = deleteConversationsAction('conv-1')
    resolveStart({ conversation, conversationId: 'conv-1', taskId: 'task', userMessageId: 'user' })
    await draining
    await expect(deleting).rejects.toThrow('删除失败')
    await drainPendingMessages('conv-1')

    expect(mocks.startTurn).toHaveBeenCalledTimes(1)
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toEqual([])
  })

  it('inject 已发起时删除失败，保留真实注入结果且不会重复注入', async () => {
    const queued = enqueuePendingMessage('conv-1', '已成功注入')
    mocks.listActiveTasks.mockResolvedValue([{ conversationId: 'conv-1', taskId: 'task', status: 'running' }])
    let resolveInject!: (value: any) => void
    mocks.injectSteering.mockReturnValue(new Promise((resolve) => {
      resolveInject = resolve
    }))
    mocks.deleteConversation.mockRejectedValueOnce(new Error('删除失败'))

    const injecting = injectPendingMessage('conv-1', queued.id)
    await vi.waitFor(() => expect(mocks.injectSteering).toHaveBeenCalledTimes(1))
    const deleting = deleteConversationsAction('conv-1')
    resolveInject({ id: 'steering', convId: 'conv-1', role: 'user', status: 'success', content: [{ type: 'text', text: '已成功注入' }] })
    await injecting
    await expect(deleting).rejects.toThrow('删除失败')

    expect(mocks.injectSteering).toHaveBeenCalledTimes(1)
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toEqual([])
    expect(useMessagesStore.getState().messages).toHaveLength(1)
  })

  it('大量删除屏障完成后不会累积 Promise 或 tombstone', async () => {
    for (let index = 0; index < 100; index++) {
      const conversationId = `cleanup-${index}`
      await drainPendingMessages(conversationId)
      const deletion = await preparePendingMessageDeletion([conversationId])
      completePendingMessageDeletion(deletion)
    }

    await vi.waitFor(() => {
      expect(getPendingMessageOperationStateForTests()).toEqual({ drainCount: 0, operationCount: 0, tombstoneCount: 0 })
    })
  })

  it('同一会话重叠删除时，一个成功 owner 释放后另一个 owner 仍阻止操作', async () => {
    const firstDeletion = await preparePendingMessageDeletion(['conv-1'])
    const secondDeletion = await preparePendingMessageDeletion(['conv-1'])
    completePendingMessageDeletion(firstDeletion)
    enqueuePendingMessage('conv-1', '仍应阻止')

    await drainPendingMessages('conv-1')
    expect(mocks.startTurn).not.toHaveBeenCalled()
    completePendingMessageDeletion(firstDeletion)
    expect(getPendingMessageOperationStateForTests().tombstoneCount).toBe(1)

    cancelPendingMessageDeletion(secondDeletion)
    await drainPendingMessages('conv-1')
    expect(mocks.startTurn).toHaveBeenCalledTimes(1)
  })

  it('同一会话重叠删除时，一个失败 owner 释放后另一个 owner 仍阻止操作', async () => {
    const firstDeletion = await preparePendingMessageDeletion(['conv-1'])
    const secondDeletion = await preparePendingMessageDeletion(['conv-1'])
    cancelPendingMessageDeletion(firstDeletion)
    enqueuePendingMessage('conv-1', '仍应阻止')

    await drainPendingMessages('conv-1')
    expect(mocks.startTurn).not.toHaveBeenCalled()

    completePendingMessageDeletion(secondDeletion)
    expect(getPendingMessageOperationStateForTests().tombstoneCount).toBe(0)
  })

  it('单删和工作区清空重叠时，任一流程未完成都保持屏障', async () => {
    let resolveDelete!: () => void
    let resolveClear!: (ids: string[]) => void
    mocks.deleteConversation.mockReturnValue(new Promise<void>((resolve) => {
      resolveDelete = resolve
    }))
    mocks.clearWorkspaceConversations.mockReturnValue(new Promise<string[]>((resolve) => {
      resolveClear = resolve
    }))

    const deleting = deleteConversationsAction('conv-1')
    const clearing = clearConversationsAction()
    await vi.waitFor(() => {
      expect(mocks.deleteConversation).toHaveBeenCalledTimes(1)
      expect(mocks.clearWorkspaceConversations).toHaveBeenCalledTimes(1)
    })
    resolveDelete()
    await deleting
    enqueuePendingMessage('conv-1', '清空仍在等待')
    await drainPendingMessages('conv-1')
    expect(mocks.startTurn).not.toHaveBeenCalled()

    resolveClear(['conv-1'])
    await clearing
    expect(getPendingMessageOperationStateForTests().tombstoneCount).toBe(0)
  })
})
