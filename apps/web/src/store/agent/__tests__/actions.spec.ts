import { describe, expect, it, vi } from 'vitest'

import { useConversationsStore } from '@/store/conversation'
import { approveAgentAction, cancelAgentTask, injectSteeringAction, rejectAgentAction, startAgentTurn, syncConversationAgentState } from '../actions'
import { useAgentStore } from '../store'

const mocks = vi.hoisted(() => ({
  injectSteering: vi.fn(async () => ({
    id: 'msg-steering-1',
    convId: 'c1',
    createdAt: 1,
    role: 'user',
    status: 'success',
    content: [{ type: 'text', text: 'adjust' }],
    turnId: 'm1',
  })),
  listActiveTasks: vi.fn(),
}))

vi.mock('@/api/agentApi', () => ({
  default: {
    startTurn: vi.fn(async () => ({ taskId: 't1', conversationId: 'c1', userMessageId: 'm1', conversation: { id: 'c1' } })),
    approvePendingAction: vi.fn(async () => null),
    rejectPendingAction: vi.fn(async () => null),
    cancelTask: vi.fn(async () => null),
    injectSteering: mocks.injectSteering,
    listActiveTasks: mocks.listActiveTasks,
  },
}))

describe('agent store actions', () => {
  it('调用 agent api', async () => {
    const created = await startAgentTurn({
      prompt: 'p',
      modelConfig: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
        features: {
          enableMCP: false,
        },
      },
    })
    expect(created.taskId).toBe('t1')
    await expect(approveAgentAction({ taskId: 't1', actionId: 'a1' })).resolves.toBeUndefined()
    await expect(rejectAgentAction({ taskId: 't1', actionId: 'a1', reason: 'r' })).resolves.toBeUndefined()
    await expect(cancelAgentTask('t1')).resolves.toBeUndefined()
    await expect(injectSteeringAction('c1', 'adjust')).resolves.toMatchObject({
      id: 'msg-steering-1',
      content: [{ type: 'text', text: 'adjust' }],
    })
    expect(mocks.injectSteering).toHaveBeenCalledWith('c1', 'adjust')
  })

  it('从 runtime 恢复 conversation 的运行状态', async () => {
    const task = {
      taskId: 't-running',
      conversationId: 'c-running',
      userMessageId: 'm1',
      workspacePath: '/tmp/workspace',
      mode: 'hybrid' as const,
      status: 'running' as const,
      createdAt: 1,
      updatedAt: 2,
      logPath: '',
      prompt: 'p',
    }
    mocks.listActiveTasks.mockResolvedValue([task])

    await syncConversationAgentState('c-running')

    expect(useAgentStore.getState().getActiveTaskByConversation('c-running')).toEqual(task)
    expect(useConversationsStore.getState().streamingConversationIds.has('c-running')).toBe(true)
  })

  it('runtime 没有 active task 时清除 conversation 的陈旧运行状态', async () => {
    useAgentStore.setState({
      tasks: {
        stale: {
          taskId: 'stale',
          conversationId: 'c-stale',
          userMessageId: 'm1',
          workspacePath: '/tmp/workspace',
          mode: 'hybrid',
          status: 'running',
          createdAt: 1,
          updatedAt: 2,
          logPath: '',
          prompt: 'p',
        },
      },
      pendingByTask: {},
    })
    useConversationsStore.setState({
      streamingConversationIds: new Set(['c-stale']),
    })
    mocks.listActiveTasks.mockResolvedValue([])

    await syncConversationAgentState('c-stale')

    expect(useAgentStore.getState().getActiveTaskByConversation('c-stale')).toBeNull()
    expect(useConversationsStore.getState().streamingConversationIds.has('c-stale')).toBe(false)
  })
})
