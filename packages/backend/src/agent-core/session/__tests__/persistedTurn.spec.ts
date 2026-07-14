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

  it('工具发布的 visualization 在最终成功和失败状态都保留，且持久化结果不含 data', async () => {
    const visualization = {
      type: 'visualization' as const,
      source: { type: 'file_id' as const, file_id: 'viz-1' },
      format: 'ant-chat.visualization.v1' as const,
      title: '趋势',
      summary: '摘要',
      size: 3,
      sha256: 'a'.repeat(64),
      data: 'eHl6',
    }
    const store = {
      createAssistantMessage: vi.fn(async () => ({ id: 'assistant-1' })),
      updateAssistantMessage: vi.fn(async (_id: string, patch: { content: Array<Record<string, unknown>> }) => ({
        id: 'assistant-1',
        content: patch.content.map((block) => {
          if (block.type !== 'visualization')
            return block
          const { data: _data, ...persisted } = block
          return persisted
        }),
      })),
    } as unknown as ISessionStore
    const emitter = createPersistedTurnEmitter(store, createDelegate(), 'turn-1', 'conv-1', () => [])

    await emitter.emitTurnStarted({
      conversationId: 'conv-1',
      model: { provider: 'provider', providerId: 'provider-1', name: 'model' },
    })
    await emitter.emitTurnToolCalls!({
      conversationId: 'conv-1',
      text: '已生成',
      toolCalls: [{
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'publish_visualization',
        args: { title: '趋势', format: 'ant-chat.visualization.v1', size: 3, sha256: 'a'.repeat(64) },
        outputBlocks: [visualization],
      } as never],
    })
    await emitter.emitTurnFinished!({ conversationId: 'conv-1', turnId: 'turn-1', text: '失败', status: 'error' })

    const updateCalls = (store.updateAssistantMessage as ReturnType<typeof vi.fn>).mock.calls
    const finalPatch = updateCalls[updateCalls.length - 1]?.[1]
    expect(finalPatch.content).toEqual([
      { type: 'text', text: '已生成' },
      expect.objectContaining({ type: 'visualization', source: visualization.source }),
      { type: 'error', error: '失败' },
    ])
    expect(finalPatch.content.find((block: { type: string }) => block.type === 'visualization')).not.toHaveProperty('data')
  })
})
