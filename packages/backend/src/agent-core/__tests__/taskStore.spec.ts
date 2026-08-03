import type { AgentPendingAction, IAgentEventEmitter } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { TaskStore } from '../taskStore'
import type { RuntimeTask } from '../taskStore'

function createTask(overrides: Partial<RuntimeTask['snapshot']> = {}): RuntimeTask {
  return {
    snapshot: {
      taskId: 'task-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-1',
      workspacePath: '/workspace',
      mode: 'hybrid',
      status: 'running',
      prompt: 'test',
      createdAt: 1000,
      updatedAt: 1000,
      ...overrides,
    },
    abortController: new AbortController(),
  }
}

function createEventEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnFinished: vi.fn(),
    emitMessageUpdated: vi.fn(),
  }
}

function createPendingAction(): AgentPendingAction {
  return {
    actionId: 'action-1',
    toolName: 'write_file',
    operationType: 'write',
    scope: 'workspace',
    inputPreview: '{"path":"test.txt"}',
    createdAt: 1000,
  }
}

describe('taskStore 行为', () => {
  describe('create 行为', () => {
    it('存储任务并注册为会话活跃任务', () => {
      const store = new TaskStore()
      const task = createTask()
      store.reserve(task)
      expect(store.listActive('conv-1')).toEqual([task.snapshot])
    })

    it('同一会话已有活跃任务时抛错', () => {
      const store = new TaskStore()
      store.reserve(createTask({ taskId: 'task-1' }))
      expect(() => store.reserve(createTask({ taskId: 'task-2' }))).toThrow(
        'AGENT_TASK_ALREADY_RUNNING',
      )
    })

    it('允许不同会话创建任务', () => {
      const store = new TaskStore()
      store.reserve(createTask({ taskId: 'task-1', conversationId: 'conv-1' }))
      expect(() =>
        store.reserve(createTask({ taskId: 'task-2', conversationId: 'conv-2' })),
      ).not.toThrow()
    })
  })

  describe('listActive 行为', () => {
    it('只列出 running 和 awaiting_approval 任务', () => {
      const store = new TaskStore()
      store.reserve(createTask({ taskId: 't1', status: 'running' }))
      store.reserve(createTask({ taskId: 't2', conversationId: 'conv-2', status: 'awaiting_approval' }))
      // finish t1 to make it inactive
      store.finish('t1')
      store.reserve(createTask({ taskId: 't3', conversationId: 'conv-1', status: 'running' }))

      const active = store.listActive()
      expect(active).toHaveLength(2)
      expect(active.map(t => t.taskId).sort()).toEqual(['t2', 't3'])
    })

    it('传入 conversationId 时按会话过滤', () => {
      const store = new TaskStore()
      store.reserve(createTask({ taskId: 't1', conversationId: 'conv-1' }))
      store.reserve(createTask({ taskId: 't2', conversationId: 'conv-2' }))

      expect(store.listActive('conv-1')).toHaveLength(1)
      expect(store.listActive('conv-1')[0].taskId).toBe('t1')
      expect(store.listActive('conv-3')).toHaveLength(0)
    })

    it('没有任务时返回空数组', () => {
      const store = new TaskStore()
      expect(store.listActive()).toEqual([])
    })
  })

  describe('finish 行为', () => {
    it('移除任务并解除会话注册', () => {
      const store = new TaskStore()
      store.reserve(createTask())
      store.finish('task-1')
      expect(store.listActive('conv-1')).toHaveLength(0)
    })

    it('taskId 不存在时不做任何处理', () => {
      const store = new TaskStore()
      expect(() => store.finish('nonexistent')).not.toThrow()
    })

    it('同一会话 finish 后允许创建新任务', () => {
      const store = new TaskStore()
      store.reserve(createTask({ taskId: 'task-1' }))
      store.finish('task-1')
      expect(() =>
        store.reserve(createTask({ taskId: 'task-2' })),
      ).not.toThrow()
    })
  })

  describe('审批行为', () => {
    it('权限规则写入失败时保留审批并允许用户重试', async () => {
      const store = new TaskStore()
      const task = createTask()
      const pendingAction = createPendingAction()
      const persistenceError = new Error('permissions write failed')
      const reportPersistenceFailure = vi.fn()
      const persistGrant = vi.fn()
        .mockImplementationOnce(() => { throw persistenceError })
        .mockImplementationOnce(() => {})
      store.reserve(task)

      const decision = store.requestApproval(
        task,
        pendingAction,
        createEventEmitter(),
        reportPersistenceFailure,
      )

      expect(() => store.approve(
        task.snapshot.taskId,
        pendingAction.actionId,
        { selections: [{ candidateIndex: 0 }], scope: 'workspace' },
        persistGrant,
      )).toThrow('permissions write failed')
      expect(reportPersistenceFailure).toHaveBeenCalledWith(persistenceError)
      expect(task.snapshot).toMatchObject({
        status: 'awaiting_approval',
        pendingAction,
      })

      store.approve(
        task.snapshot.taskId,
        pendingAction.actionId,
        { selections: [{ candidateIndex: 0 }], scope: 'workspace' },
        persistGrant,
      )

      await expect(decision).resolves.toMatchObject({ approved: true })
      expect(task.snapshot.status).toBe('running')
      expect(task.snapshot.pendingAction).toBeUndefined()
    })
  })

  describe('updateMode 行为', () => {
    it('更新运行中任务的权限模式并推进 updatedAt', () => {
      const store = new TaskStore()
      const task = createTask({ mode: 'strict' })
      store.reserve(task)

      const returned = store.updateMode(task.snapshot.taskId, 'full_managed')

      expect(returned).toBeDefined()
      expect(returned!.snapshot).toMatchObject({ taskId: task.snapshot.taskId, mode: 'full_managed' })
      expect(task.snapshot.mode).toBe('full_managed')
      expect(task.snapshot.updatedAt).toBeGreaterThan(1000)
      expect(store.getSnapshot(task.snapshot.taskId)).toMatchObject({ mode: 'full_managed' })
    })

    it('未知任务返回 undefined 且不抛错', () => {
      const store = new TaskStore()
      expect(store.updateMode('missing-task', 'hybrid')).toBeUndefined()
    })

    it('终态任务不接受权限模式更新', () => {
      const store = new TaskStore()
      const task = createTask({ mode: 'strict', status: 'success' })
      store.reserve(task)

      expect(store.updateMode(task.snapshot.taskId, 'full_managed')).toBeUndefined()
      expect(task.snapshot.mode).toBe('strict')
    })
  })
})
