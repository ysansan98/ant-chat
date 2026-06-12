import type { ConversationsId, IMessage } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addPendingSteeringMessage, setActiveConversationsId, updateMessageActionV2 } from '../actions'
import { useMessagesStore } from '../store'

const mocks = vi.hoisted(() => ({
  getMessagesByConvId: vi.fn<(conversationId: string) => Promise<IMessage[]>>(),
  listActiveTasks: vi.fn(async () => []),
}))

vi.mock('@/api/chatApi', () => ({
  default: {
    getMessagesByConvId: mocks.getMessagesByConvId,
  },
}))

vi.mock('@/api/agentApi', () => ({
  default: {
    listActiveTasks: mocks.listActiveTasks,
  },
}))

describe('message actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMessagesByConvId.mockResolvedValue([])
    useMessagesStore.setState({
      activeConversationsId: 'conv-1' as ConversationsId,
      messages: [],
      pendingSteeringByConversation: {},
    })
  })

  it('keeps pending steering visible after switching away and back before persistence', async () => {
    const pending = createUserMessage('msg-steering-1', 'conv-1', 1)
    addPendingSteeringMessage(pending)

    await setActiveConversationsId('conv-2' as ConversationsId)
    expect(useMessagesStore.getState().messages).toEqual([])

    await setActiveConversationsId('conv-1' as ConversationsId)
    expect(useMessagesStore.getState().messages).toEqual([pending])
  })

  it('clears background pending steering when its persisted event arrives', async () => {
    const pending = createUserMessage('msg-steering-1', 'conv-1', 1)
    addPendingSteeringMessage(pending)
    await setActiveConversationsId('conv-2' as ConversationsId)

    const persisted = createUserMessage('msg-steering-1', 'conv-1', 3)
    await updateMessageActionV2(persisted)

    expect(useMessagesStore.getState().pendingSteeringByConversation).toEqual({})
    mocks.getMessagesByConvId.mockResolvedValue([persisted])
    await setActiveConversationsId('conv-1' as ConversationsId)
    expect(useMessagesStore.getState().messages).toEqual([persisted])
  })

  it('reconciles pending steering from persisted messages when the event was missed', async () => {
    const pending = createUserMessage('msg-steering-1', 'conv-1', 1)
    addPendingSteeringMessage(pending)
    await setActiveConversationsId('conv-2' as ConversationsId)

    const persisted = createUserMessage('msg-steering-1', 'conv-1', 3)
    mocks.getMessagesByConvId.mockResolvedValue([persisted])
    await setActiveConversationsId('conv-1' as ConversationsId)

    expect(useMessagesStore.getState().messages).toEqual([persisted])
    expect(useMessagesStore.getState().pendingSteeringByConversation).toEqual({})
  })

  it('does not add pending steering when the persisted event arrived first', async () => {
    const persisted = createUserMessage('msg-steering-1', 'conv-1', 3)
    await updateMessageActionV2(persisted)

    const acknowledgement = createUserMessage('msg-steering-1', 'conv-1', 1)
    addPendingSteeringMessage(acknowledgement)

    expect(useMessagesStore.getState().messages).toEqual([persisted])
    expect(useMessagesStore.getState().pendingSteeringByConversation).toEqual({})
  })

  it('matches repeated steering text by stable message id', async () => {
    const first = createUserMessage('msg-steering-1', 'conv-1', 1)
    const second = createUserMessage('msg-steering-2', 'conv-1', 2)
    addPendingSteeringMessage(first)
    addPendingSteeringMessage(second)

    const toolResult = createToolMessage('tool-1', 'conv-1', 3)
    await updateMessageActionV2(toolResult)
    const persistedSecond = createUserMessage('msg-steering-2', 'conv-1', 4)
    await updateMessageActionV2(persistedSecond)

    expect(useMessagesStore.getState().messages).toEqual([first, toolResult, persistedSecond])
    expect(useMessagesStore.getState().pendingSteeringByConversation).toEqual({
      'conv-1': [first],
    })
  })
})

function createUserMessage(id: string, convId: string, createdAt: number): IMessage {
  return {
    id,
    convId: convId as ConversationsId,
    createdAt,
    role: 'user',
    status: 'success',
    content: [{ type: 'text', text: 'adjust' }],
    turnId: 'turn-1',
  }
}

function createToolMessage(id: string, convId: string, createdAt: number): IMessage {
  return {
    id,
    convId: convId as ConversationsId,
    createdAt,
    role: 'tool',
    status: 'success',
    content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'read_file', result: 'done' }],
    turnId: 'turn-1',
  }
}
