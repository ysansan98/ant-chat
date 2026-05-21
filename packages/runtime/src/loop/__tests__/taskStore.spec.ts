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

describe('taskStore', () => {
  describe('create', () => {
    it('stores a task and registers it as active for the conversation', () => {
      const store = new TaskStore()
      const task = createTask()
      store.create(task)
      expect(store.get('task-1')).toBe(task)
    })

    it('throws when a task is already active for the same conversation', () => {
      const store = new TaskStore()
      store.create(createTask({ taskId: 'task-1' }))
      expect(() => store.create(createTask({ taskId: 'task-2' }))).toThrow(
        'AGENT_TASK_ALREADY_RUNNING',
      )
    })

    it('allows tasks for different conversations', () => {
      const store = new TaskStore()
      store.create(createTask({ taskId: 'task-1', conversationId: 'conv-1' }))
      expect(() =>
        store.create(createTask({ taskId: 'task-2', conversationId: 'conv-2' })),
      ).not.toThrow()
    })
  })

  describe('get', () => {
    it('returns the task by id', () => {
      const store = new TaskStore()
      const task = createTask()
      store.create(task)
      expect(store.get('task-1')).toBe(task)
    })

    it('returns undefined for unknown taskId', () => {
      const store = new TaskStore()
      expect(store.get('nonexistent')).toBeUndefined()
    })
  })

  describe('listActive', () => {
    it('lists only running/awaiting_approval tasks', () => {
      const store = new TaskStore()
      store.create(createTask({ taskId: 't1', status: 'running' }))
      store.create(createTask({ taskId: 't2', conversationId: 'conv-2', status: 'awaiting_approval' }))
      // finish t1 to make it inactive
      store.finish('t1')
      store.create(createTask({ taskId: 't3', conversationId: 'conv-1', status: 'running' }))

      const active = store.listActive()
      expect(active).toHaveLength(2)
      expect(active.map(t => t.taskId).sort()).toEqual(['t2', 't3'])
    })

    it('filters by conversationId when provided', () => {
      const store = new TaskStore()
      store.create(createTask({ taskId: 't1', conversationId: 'conv-1' }))
      store.create(createTask({ taskId: 't2', conversationId: 'conv-2' }))

      expect(store.listActive('conv-1')).toHaveLength(1)
      expect(store.listActive('conv-1')[0].taskId).toBe('t1')
      expect(store.listActive('conv-3')).toHaveLength(0)
    })

    it('returns empty array when no tasks', () => {
      const store = new TaskStore()
      expect(store.listActive()).toEqual([])
    })
  })

  describe('finish', () => {
    it('removes the task and unregisters from conversation', () => {
      const store = new TaskStore()
      store.create(createTask())
      store.finish('task-1')
      expect(store.get('task-1')).toBeUndefined()
      expect(store.listActive('conv-1')).toHaveLength(0)
    })

    it('no-ops for non-existent taskId', () => {
      const store = new TaskStore()
      expect(() => store.finish('nonexistent')).not.toThrow()
    })

    it('allows creating a new task after finish on the same conversation', () => {
      const store = new TaskStore()
      store.create(createTask({ taskId: 'task-1' }))
      store.finish('task-1')
      expect(() =>
        store.create(createTask({ taskId: 'task-2' })),
      ).not.toThrow()
    })
  })

  describe('delete', () => {
    it('removes the task and unregisters from conversation', () => {
      const store = new TaskStore()
      store.create(createTask())
      store.delete('task-1')
      expect(store.get('task-1')).toBeUndefined()
      expect(store.listActive('conv-1')).toHaveLength(0)
    })

    it('no-ops for non-existent taskId', () => {
      const store = new TaskStore()
      expect(() => store.delete('nonexistent')).not.toThrow()
    })
  })
})
