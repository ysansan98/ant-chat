import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPersistedTurnEmitter } from '../persistedTurn'
import type { IAgentEventEmitter, ISessionStore } from '@ant-chat/shared'

function createDelegate(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnToolResults: vi.fn(),
    emitTurnFinished: vi.fn(),
    emitMessageUpdated: vi.fn(),
  }
}

describe('persistedTurn 行为', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('达到节流间隔后才持久化新的文本增量', async () => {
    vi.useFakeTimers()
    const store = {
      createAssistantMessage: vi.fn(async () => ({ id: 'assistant-1' })),
      updateAssistantMessage: vi.fn(async () => ({ id: 'assistant-1' })),
    } as unknown as ISessionStore
    const emitter = createPersistedTurnEmitter(store, createDelegate(), 'turn-1', 'conv-1', () => [])

    await emitter.emitTurnStarted({
      conversationId: 'conv-1',
      model: { provider: 'provider', providerId: 'provider-1', name: 'model' },
    })
    vi.setSystemTime(100)
    await emitter.emitTurnChunk({
      conversationId: 'conv-1',
      accumulatedText: '第一段',
      chunk: { content: [{ type: 'text', text: '第一段' }] },
    })
    vi.setSystemTime(150)
    await emitter.emitTurnChunk({
      conversationId: 'conv-1',
      accumulatedText: '第一段第二段',
      chunk: { content: [{ type: 'text', text: '第二段' }] },
    })
    vi.setSystemTime(181)
    await emitter.emitTurnChunk({
      conversationId: 'conv-1',
      accumulatedText: '第一段第二段第三段',
      chunk: { content: [{ type: 'text', text: '第三段' }] },
    })

    expect(store.updateAssistantMessage).toHaveBeenCalledTimes(2)
    expect(store.updateAssistantMessage).toHaveBeenLastCalledWith('assistant-1', expect.objectContaining({
      content: [{ type: 'text', text: '第一段第二段第三段' }],
    }))
  })

  it('工具结果持久化后才持久化 steering', async () => {
    const writes: string[] = []
    const store = {
      createAssistantMessage: vi.fn(async () => ({ id: 'assistant-1' })),
      updateAssistantMessage: vi.fn(async () => ({ id: 'assistant-1' })),
      createToolMessage: vi.fn(async () => {
        writes.push('tool')
        return { id: 'tool-1' }
      }),
      createUserMessage: vi.fn(async () => {
        writes.push('steering')
        return { id: 'steering-1' }
      }),
    } as unknown as ISessionStore
    const emitter = createPersistedTurnEmitter(store, createDelegate(), 'turn-1', 'conv-1', () => [{
      id: 'steering-1',
      text: '继续',
      turnId: 'turn-1',
    }])

    await emitter.emitTurnStarted({
      conversationId: 'conv-1',
      model: { provider: 'provider', providerId: 'provider-1', name: 'model' },
    })
    await emitter.emitTurnToolResults!({
      conversationId: 'conv-1',
      results: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'read_file', result: 'ok' }],
    })

    expect(writes).toEqual(['tool', 'steering'])
  })

  it('最终持久化失败后仍释放 turn 状态', async () => {
    const store = {
      createAssistantMessage: vi.fn(async () => ({ id: 'assistant-1' })),
      updateAssistantMessage: vi.fn().mockRejectedValue(new Error('store unavailable')),
    } as unknown as ISessionStore
    const emitter = createPersistedTurnEmitter(store, createDelegate(), 'turn-1', 'conv-1', () => [])

    await emitter.emitTurnStarted({
      conversationId: 'conv-1',
      model: { provider: 'provider', providerId: 'provider-1', name: 'model' },
    })
    await expect(emitter.emitTurnFinished!({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      text: 'failed',
      status: 'error',
    })).rejects.toThrow('store unavailable')

    await expect(emitter.emitTurnFinished!({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      text: 'failed again',
      status: 'error',
    })).resolves.toBeUndefined()
  })
})
