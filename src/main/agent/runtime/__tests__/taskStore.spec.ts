import type { AgentTaskSnapshot } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { TaskStore } from '../taskStore'

function createTask(snapshot: Partial<AgentTaskSnapshot> = {}) {
  const now = Date.now()
  const s: AgentTaskSnapshot = {
    taskId: snapshot.taskId ?? 'task-1',
    conversationId: snapshot.conversationId ?? 'conv-1',
    userMessageId: snapshot.userMessageId ?? 'msg-1',
    workspacePath: '/tmp/ws',
    mode: 'hybrid',
    status: snapshot.status ?? 'running',
    createdAt: now,
    updatedAt: now,
    checkpointPath: '',
    logPath: '',
    prompt: 'hello',
    progress: [],
  }
  return { snapshot: s, abortController: new AbortController() }
}

describe('taskStore', () => {
  it('同会话禁止并发 active task', () => {
    const store = new TaskStore()
    store.create(createTask({ taskId: 't1', conversationId: 'c1' }))
    expect(() => store.create(createTask({ taskId: 't2', conversationId: 'c1' }))).toThrow('AGENT_TASK_ALREADY_RUNNING')
  })

  it('listActive 只返回 running/awaiting_approval', () => {
    const store = new TaskStore()
    store.create(createTask({ taskId: 't1', status: 'running', conversationId: 'c1' }))
    store.create(createTask({ taskId: 't2', status: 'awaiting_approval', conversationId: 'c2' }))
    store.create(createTask({ taskId: 't3', status: 'success', conversationId: 'c3' }))
    expect(store.listActive().map(i => i.taskId)).toEqual(['t1', 't2'])
    expect(store.listActive('c2').map(i => i.taskId)).toEqual(['t2'])
  })

  it('finish 后同会话可再次创建 task', () => {
    const store = new TaskStore()
    store.create(createTask({ taskId: 't1', conversationId: 'c1' }))
    store.finish('t1')
    expect(() => store.create(createTask({ taskId: 't2', conversationId: 'c1' }))).not.toThrow()
  })
})
