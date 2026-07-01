import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearConversationPendingMessages, editPendingMessage, enqueuePendingMessage, removePendingMessage } from '../actions'
import { usePendingMessagesStore } from '../store'

describe('pending messages store', () => {
  beforeEach(() => {
    localStorage.clear()
    usePendingMessagesStore.setState({ itemsByConversation: {} })
  })

  afterEach(() => vi.restoreAllMocks())

  it('按会话隔离并保持 FIFO', () => {
    const first = enqueuePendingMessage('conv-a', '第一条')
    const second = enqueuePendingMessage('conv-a', '第二条')
    enqueuePendingMessage('conv-b', '其他会话')
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-a'].map(item => item.id)).toEqual([first.id, second.id])
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-b']).toHaveLength(1)
  })

  it('编辑和删除正常运行', () => {
    const queued = enqueuePendingMessage('conv-a', '原文')
    editPendingMessage('conv-a', queued.id, '新文本')
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-a'][0].text).toBe('新文本')
    removePendingMessage('conv-a', queued.id)
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-a']).toEqual([])
    enqueuePendingMessage('conv-a', '再次添加')
    clearConversationPendingMessages('conv-a')
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-a']).toBeUndefined()
  })

  it.each([
    ['无法解析的 JSON', '{bad json'],
    ['合法 JSON 中的损坏结构', JSON.stringify({ state: { itemsByConversation: { 'conv-a': [{ id: 1 }] } }, version: 2 })],
  ])('%s 在恢复时回退为空队列并记录 warning', async (_, storedValue) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    usePendingMessagesStore.setState({ itemsByConversation: { stale: [] } })
    localStorage.setItem('ant-chat:pending-messages:v1', storedValue)

    await usePendingMessagesStore.persist.rehydrate()

    expect(usePendingMessagesStore.getState().itemsByConversation).toEqual({})
    expect(warn).toHaveBeenCalledWith('恢复待处理消息失败，已回退为空队列', expect.anything())
  })
})
