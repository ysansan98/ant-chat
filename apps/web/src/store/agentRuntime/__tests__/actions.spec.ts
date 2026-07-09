import type { AgentTaskSnapshot } from '@ant-chat/shared'

import { describe, expect, it, vi } from 'vitest'
import { useConversationsStore } from '@/store/conversation'
import {
  applyApprovalRequired,
  applyTaskUpdate,
  approveAgentAction,
  cancelAgentTask,
  injectSteeringAction,
  isRunning,
  rejectAgentAction,
  startAgentTurn,
  syncConversationRuntime,
} from '../actions'
import { isTaskActive } from '../predicates'
import { useAgentRuntimeStore } from '../store'

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

function createTask(overrides: Partial<AgentTaskSnapshot> = {}): AgentTaskSnapshot {
  return {
    taskId: 't-running',
    conversationId: 'c-running',
    userMessageId: 'm1',
    workspacePath: '/tmp/workspace',
    mode: 'hybrid',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    logPath: '',
    prompt: 'p',
    ...overrides,
  }
}

describe('agentRuntime 谓词', () => {
  it('isTaskActive 仅对 running / awaiting_approval 返回 true', () => {
    expect(isTaskActive(createTask({ status: 'running' }))).toBe(true)
    expect(isTaskActive(createTask({ status: 'awaiting_approval' }))).toBe(true)
    expect(isTaskActive(createTask({ status: 'success' }))).toBe(false)
    expect(isTaskActive(createTask({ status: 'failed' }))).toBe(false)
    expect(isTaskActive(createTask({ status: 'cancelled' }))).toBe(false)
  })

  it('isRunning 反映会话是否存在活跃任务', () => {
    useAgentRuntimeStore.setState({ tasks: {}, pendingByTask: {}, executionPhaseByTurn: {}, secretRequests: {} })
    expect(isRunning('c1')).toBe(false)

    useAgentRuntimeStore.getState().setTask(createTask({ taskId: 't1', conversationId: 'c1', status: 'running' }))
    expect(isRunning('c1')).toBe(true)

    useAgentRuntimeStore.getState().setTask(createTask({ taskId: 't1', conversationId: 'c1', status: 'success' }))
    expect(isRunning('c1')).toBe(false)
  })
})

describe('agentRuntime 事件对账', () => {
  it('applyTaskUpdate 在活跃任务上派生 running 状态', () => {
    useAgentRuntimeStore.setState({ tasks: {}, pendingByTask: {}, executionPhaseByTurn: {}, secretRequests: {} })
    useConversationsStore.setState({ conversationStates: {} })

    applyTaskUpdate(createTask({ taskId: 't1', conversationId: 'c-active', status: 'running' }))

    expect(useAgentRuntimeStore.getState().getActiveTaskByConversation('c-active')?.taskId).toBe('t1')
    expect(useConversationsStore.getState().conversationStates['c-active']).toBe('running')
  })

  it('applyTaskUpdate 在活跃会话转终态时回到 idle，后台会话标记 completed', () => {
    useAgentRuntimeStore.setState({ tasks: {}, pendingByTask: {}, executionPhaseByTurn: {}, secretRequests: {} })

    // 后台会话（非 activeConversationsId）转终态 → completed
    useConversationsStore.setState({ activeConversationsId: 'c-foreground' as never, conversationStates: {} })
    applyTaskUpdate(createTask({ taskId: 't-bg', conversationId: 'c-background', status: 'success' }))
    expect(useConversationsStore.getState().conversationStates['c-background']).toBe('completed')

    // 活跃会话转终态 → 移除 running（idle）
    useConversationsStore.setState({ activeConversationsId: 'c-foreground' as never, conversationStates: { 'c-foreground': 'running' } })
    applyTaskUpdate(createTask({ taskId: 't-fg', conversationId: 'c-foreground', status: 'success' }))
    expect(useConversationsStore.getState().conversationStates['c-foreground']).toBeUndefined()
  })

  it('applyTaskUpdate 在任务不再携带 pendingAction 时清理待审批', () => {
    useAgentRuntimeStore.setState({
      tasks: {},
      pendingByTask: { t1: { actionId: 'a1', toolName: 'bash', operationType: 'bash', scope: 'workspace', inputPreview: '', createdAt: 1 } },
      executionPhaseByTurn: {},
      secretRequests: {},
    })

    applyTaskUpdate(createTask({ taskId: 't1', status: 'success' }))

    expect(useAgentRuntimeStore.getState().pendingByTask.t1).toBeUndefined()
  })

  it('applyApprovalRequired 写入待审批项', () => {
    useAgentRuntimeStore.setState({ tasks: {}, pendingByTask: {}, executionPhaseByTurn: {}, secretRequests: {} })

    applyApprovalRequired('t1', { actionId: 'a1', toolName: 'bash', operationType: 'bash', scope: 'workspace', inputPreview: '', createdAt: 1 })

    expect(useAgentRuntimeStore.getState().pendingByTask.t1?.actionId).toBe('a1')
  })
})

describe('agentRuntime RPC 转发与远程对账', () => {
  it('调用 agent api', async () => {
    const created = await startAgentTurn({
      prompt: 'p',
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
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
    const task = createTask({ conversationId: 'c-running' })
    mocks.listActiveTasks.mockResolvedValue([task])

    await syncConversationRuntime('c-running')

    expect(useAgentRuntimeStore.getState().getActiveTaskByConversation('c-running')).toEqual(task)
    expect(useAgentRuntimeStore.getState().executionPhaseByTurn.m1).toBe('waiting_model')
    expect(useConversationsStore.getState().conversationStates['c-running']).toBe('running')
  })

  it('任务进入终态时移除 turn 执行阶段', () => {
    useAgentRuntimeStore.setState({ tasks: {}, pendingByTask: {}, executionPhaseByTurn: {}, secretRequests: {} })
    const task = createTask({ executionPhase: 'thinking' })
    useAgentRuntimeStore.getState().setTask(task)

    useAgentRuntimeStore.getState().setTask({ ...task, status: 'success' })

    expect(useAgentRuntimeStore.getState().executionPhaseByTurn.m1).toBeUndefined()
  })

  it('runtime 没有 active task 时清除 conversation 的陈旧运行状态', async () => {
    useAgentRuntimeStore.setState({
      tasks: {
        stale: createTask({ taskId: 'stale', conversationId: 'c-stale' }),
      },
      pendingByTask: {},
      executionPhaseByTurn: {},
      secretRequests: {},
    })
    useConversationsStore.setState({
      conversationStates: { 'c-stale': 'running' },
    })
    mocks.listActiveTasks.mockResolvedValue([])

    await syncConversationRuntime('c-stale')

    expect(useAgentRuntimeStore.getState().getActiveTaskByConversation('c-stale')).toBeNull()
    expect(useConversationsStore.getState().conversationStates['c-stale']).toBeUndefined()
  })
})
