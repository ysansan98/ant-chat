import { beforeEach, describe, expect, it } from 'vitest'
import { usePendingMessagesStore } from '../store'

function snapshot(conversationId: string, revision: number, texts: string[]) {
  return {
    conversationId,
    revision,
    messages: texts.map((text, index) => ({
      id: `${conversationId}-${revision}-${index}`,
      conversationId,
      text,
      source: 'sender' as const,
      createdAt: index + 1,
    })),
  }
}

describe('pending messages 投影 store', () => {
  beforeEach(() => {
    usePendingMessagesStore.setState({ itemsByConversation: {}, revisionByConversation: {} })
  })

  it('按会话覆盖快照并保持服务端顺序', () => {
    usePendingMessagesStore.getState().applySnapshot(snapshot('conv-a', 1, ['第一条', '第二条']))
    usePendingMessagesStore.getState().applySnapshot(snapshot('conv-b', 1, ['其他会话']))

    const state = usePendingMessagesStore.getState()
    expect(state.itemsByConversation['conv-a']?.map(item => item.text)).toEqual(['第一条', '第二条'])
    expect(state.itemsByConversation['conv-b']).toHaveLength(1)
  })

  it('revision 回退的快照被丢弃，force 时强制应用', () => {
    usePendingMessagesStore.getState().applySnapshot(snapshot('conv-a', 5, ['新版']))
    usePendingMessagesStore.getState().applySnapshot(snapshot('conv-a', 4, ['旧版']))
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-a']?.map(item => item.text)).toEqual(['新版'])

    usePendingMessagesStore.getState().applySnapshot(snapshot('conv-a', 1, ['对账']), { force: true })
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-a']?.map(item => item.text)).toEqual(['对账'])
    expect(usePendingMessagesStore.getState().revisionByConversation['conv-a']).toBe(1)
  })

  it('clearConversation 只清理目标会话投影', () => {
    usePendingMessagesStore.getState().applySnapshot(snapshot('conv-a', 1, ['A']))
    usePendingMessagesStore.getState().applySnapshot(snapshot('conv-b', 1, ['B']))

    usePendingMessagesStore.getState().clearConversation('conv-a')

    const state = usePendingMessagesStore.getState()
    expect(state.itemsByConversation['conv-a']).toBeUndefined()
    expect(state.revisionByConversation['conv-a']).toBeUndefined()
    expect(state.itemsByConversation['conv-b']).toHaveLength(1)
  })
})
