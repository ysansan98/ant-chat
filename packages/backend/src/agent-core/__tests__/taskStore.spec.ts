import { describe, expect, it } from 'vitest'
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
      logPath: '',
      ...overrides,
    },
    abortController: new AbortController(),
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
})
