import type { AppPendingMessageSnapshot, IMessage } from '@ant-chat/shared'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingMessageRecord, PendingMessageRepository } from '../../data'
import { createPendingMessageService } from '../pendingMessageService'

function createRepository(): PendingMessageRepository & { records: Map<string, PendingMessageRecord> } {
  const records = new Map<string, PendingMessageRecord>()
  const key = (conversationId: string, id: string) => `${conversationId}:${id}`
  return {
    records,
    listByConversation: vi.fn(async conversationId =>
      [...records.values()]
        .filter(record => record.conversationId === conversationId)
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))),
    get: vi.fn(async (conversationId, id) => records.get(key(conversationId, id))),
    create: vi.fn(async (record) => {
      records.set(key(record.conversationId, record.id), record)
      return record
    }),
    updateText: vi.fn(async (conversationId, id, text) => {
      const current = records.get(key(conversationId, id))
      if (!current)
        return undefined
      const next = { ...current, text }
      records.set(key(conversationId, id), next)
      return next
    }),
    delete: vi.fn(async (conversationId, id) => records.delete(key(conversationId, id))),
  }
}

function createSteeringMessage(text: string): IMessage {
  return {
    id: 'msg-steering',
    convId: 'conv-1',
    createdAt: 1,
    role: 'user',
    status: 'success',
    content: [{ type: 'text', text }],
    turnId: 'turn-1',
  }
}

describe('pendingMessageService', () => {
  let repository: ReturnType<typeof createRepository>
  let emitUpdated: Mock<(snapshot: AppPendingMessageSnapshot) => void>
  let injectSteering: Mock<(conversationId: string, text: string) => Promise<IMessage>>

  beforeEach(() => {
    repository = createRepository()
    emitUpdated = vi.fn()
    injectSteering = vi.fn(async (_conversationId: string, text: string) => createSteeringMessage(text))
  })

  function createService() {
    return createPendingMessageService({
      repository,
      injectSteering,
      emitUpdated,
      logger: { info() {}, warn() {}, error() {} },
    })
  }

  it('入队保存来源与接力元数据，并广播带版本号的快照', async () => {
    const service = createService()
    const snapshot = await service.enqueue({
      conversationId: 'conv-1',
      text: '  调整实现  ',
      source: 'sender',
      mode: 'hybrid',
      userMessageId: 'm1',
    })

    expect(snapshot.messages).toEqual([
      expect.objectContaining({ text: '调整实现', source: 'sender', conversationId: 'conv-1' }),
    ])
    expect(snapshot.revision).toBe(1)
    expect(emitUpdated).toHaveBeenCalledWith(snapshot)
    const record = [...repository.records.values()][0]
    expect(record).toMatchObject({ text: '调整实现', mode: 'hybrid', userMessageId: 'm1' })
  })

  it('会话内 createdAt 单调递增，保证 FIFO', async () => {
    const service = createService()
    await service.enqueue({ conversationId: 'conv-1', text: '第一条', source: 'sender' })
    const second = await service.enqueue({ conversationId: 'conv-1', text: '第二条', source: 'sender' })

    expect(second.messages.map(message => message.text)).toEqual(['第一条', '第二条'])
    expect(second.messages[1]!.createdAt).toBeGreaterThan(second.messages[0]!.createdAt)
    expect(second.revision).toBe(2)
  })

  it('空文本入队与空文本编辑被拒绝', async () => {
    const service = createService()
    await expect(service.enqueue({ conversationId: 'conv-1', text: '   ', source: 'sender' })).rejects.toThrow('待处理消息内容不能为空')
    await service.enqueue({ conversationId: 'conv-1', text: '原始', source: 'sender' })
    await expect(service.edit('conv-1', 'p1', '  ')).rejects.toThrow('待处理消息内容不能为空')
  })

  it('编辑不存在的记录时报错，删除幂等广播', async () => {
    const service = createService()
    await expect(service.edit('conv-1', 'missing', '新文本')).rejects.toThrow('待处理消息不存在')

    const snapshot = await service.remove('conv-1', 'missing')
    expect(snapshot.messages).toEqual([])
    expect(emitUpdated).toHaveBeenCalled()
  })

  it('引导：注入成功后出队并广播', async () => {
    const service = createService()
    await service.enqueue({ conversationId: 'conv-1', text: '引导内容', source: 'sender' })
    const id = [...repository.records.values()][0].id

    const result = await service.steer('conv-1', id)

    expect(injectSteering).toHaveBeenCalledWith('conv-1', '引导内容')
    expect(result.message.id).toBe('msg-steering')
    expect(result.snapshot.messages).toEqual([])
    expect(repository.records.size).toBe(0)
  })

  it('引导：注入失败时保留队列项（D3 回滚语义）', async () => {
    const service = createService()
    await service.enqueue({ conversationId: 'conv-1', text: '引导内容', source: 'sender' })
    const id = [...repository.records.values()][0].id
    injectSteering.mockRejectedValueOnce(new Error('AGENT_TASK_NOT_RUNNING'))

    await expect(service.steer('conv-1', id)).rejects.toThrow('AGENT_TASK_NOT_RUNNING')
    expect(repository.records.size).toBe(1)
    // 失败路径不广播空快照，前端投影保持原样
    expect(emitUpdated).toHaveBeenCalledTimes(1)
  })

  it('只返回当前会话的记录', async () => {
    const service = createService()
    await service.enqueue({ conversationId: 'conv-1', text: 'A', source: 'sender' })
    await service.enqueue({ conversationId: 'conv-2', text: 'B', source: 'channel' })

    const snapshot = await service.snapshot('conv-2')
    expect(snapshot.messages.map(message => message.text)).toEqual(['B'])
  })
})
