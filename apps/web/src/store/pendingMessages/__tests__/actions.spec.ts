import type { AppPendingMessage, AppPendingMessageSnapshot } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessagesStore } from '@/store/messages'
import {
  applyPendingMessageSnapshot,
  editPendingMessageAction,
  removePendingMessageAction,
  steerPendingMessageAction,
  syncPendingMessages,
} from '../actions'
import { usePendingMessagesStore } from '../store'

const mocks = vi.hoisted(() => ({
  listPendingMessages: vi.fn(),
  editPendingMessage: vi.fn(),
  removePendingMessage: vi.fn(),
  steerPendingMessage: vi.fn(),
}))

vi.mock('@/api/agentApi', () => ({ default: mocks }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }))

function createMessage(overrides: Partial<AppPendingMessage> = {}): AppPendingMessage {
  return {
    id: 'p1',
    conversationId: 'conv-1',
    text: '待处理消息',
    source: 'sender',
    createdAt: 1,
    ...overrides,
  }
}

function createSnapshot(overrides: Partial<AppPendingMessageSnapshot> = {}): AppPendingMessageSnapshot {
  return {
    conversationId: 'conv-1',
    revision: 1,
    messages: [createMessage()],
    ...overrides,
  }
}

describe('pendingMessages 投影对账', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePendingMessagesStore.setState({ itemsByConversation: {}, revisionByConversation: {} })
    useMessagesStore.getState().reset()
  })

  it('事件快照按 revision 丢弃乱序旧版本', () => {
    applyPendingMessageSnapshot(createSnapshot({ revision: 2, messages: [createMessage({ text: '新版' })] }))
    applyPendingMessageSnapshot(createSnapshot({ revision: 1, messages: [createMessage({ text: '旧版' })] }))

    const state = usePendingMessagesStore.getState()
    expect(state.itemsByConversation['conv-1']?.map(item => item.text)).toEqual(['新版'])
    expect(state.revisionByConversation['conv-1']).toBe(2)
  })

  it('syncPendingMessages 强制应用拉取快照并覆盖本地 revision', async () => {
    mocks.listPendingMessages.mockResolvedValue(createSnapshot({ revision: 1, messages: [createMessage({ text: '服务端' })] }))
    applyPendingMessageSnapshot(createSnapshot({ revision: 9, messages: [createMessage({ text: '本地' })] }))

    await syncPendingMessages('conv-1')

    expect(mocks.listPendingMessages).toHaveBeenCalledWith('conv-1')
    const state = usePendingMessagesStore.getState()
    expect(state.itemsByConversation['conv-1']?.map(item => item.text)).toEqual(['服务端'])
    expect(state.revisionByConversation['conv-1']).toBe(1)
  })

  it('编辑走 RPC 并以响应快照对账；空文本转为删除', async () => {
    mocks.editPendingMessage.mockResolvedValue(createSnapshot({ revision: 3, messages: [createMessage({ text: '修改后' })] }))
    mocks.removePendingMessage.mockResolvedValue(createSnapshot({ revision: 4, messages: [] }))

    await editPendingMessageAction('conv-1', 'p1', ' 修改后 ')
    expect(mocks.editPendingMessage).toHaveBeenCalledWith('conv-1', 'p1', '修改后')
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']?.map(item => item.text)).toEqual(['修改后'])

    await editPendingMessageAction('conv-1', 'p1', '   ')
    expect(mocks.removePendingMessage).toHaveBeenCalledWith('conv-1', 'p1')
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toEqual([])
  })

  it('删除失败时保留投影并由 toast 提示', async () => {
    const { toast } = await import('sonner')
    applyPendingMessageSnapshot(createSnapshot())
    mocks.removePendingMessage.mockRejectedValue(new Error('rpc down'))

    await removePendingMessageAction('conv-1', 'p1')

    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith('rpc down')
  })

  it('引导成功后应用出队快照并合并 steering 消息', async () => {
    applyPendingMessageSnapshot(createSnapshot())
    mocks.steerPendingMessage.mockResolvedValue({
      message: {
        id: 'msg-steering',
        convId: 'conv-1',
        createdAt: 2,
        role: 'user',
        status: 'success',
        content: [{ type: 'text', text: '待处理消息' }],
        turnId: 'turn-1',
      },
      snapshot: createSnapshot({ revision: 2, messages: [] }),
    })

    await steerPendingMessageAction('conv-1', 'p1')

    expect(mocks.steerPendingMessage).toHaveBeenCalledWith('conv-1', 'p1')
    expect(usePendingMessagesStore.getState().itemsByConversation['conv-1']).toEqual([])
  })
})
