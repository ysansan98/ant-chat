import type { IAgentEventEmitter, ISessionStore, MessageContent, ToolCallContent } from '@ant-chat/shared'

const STREAM_UPDATE_INTERVAL_MS = 80

interface TurnMeta {
  msgId: string
  modelText: string
  reasoningText: string
  latestUsage: Record<string, number> | undefined
  lastUpdateAt: number
  persistedToolCallIds: Set<string>
}

export function createPersistedTurnEmitter(store: ISessionStore, delegate: IAgentEventEmitter, turnId: string, conversationId: string, takePendingSteeringMessages: () => Array<{ id: string, text: string, turnId: string }>): IAgentEventEmitter {
  const turns = new Map<string, TurnMeta>()

  function newTurnMeta(msgId: string): TurnMeta {
    return {
      msgId,
      modelText: '',
      reasoningText: '',
      latestUsage: undefined,
      lastUpdateAt: 0,
      persistedToolCallIds: new Set(),
    }
  }

  async function flushTurn(meta: TurnMeta) {
    const message = await store.updateAssistantMessage(meta.msgId, {
      role: 'assistant',
      status: 'loading',
      content: [{ type: 'text', text: meta.modelText.trim() || '...' }],
      reasoningContent: meta.reasoningText,
      usage: meta.latestUsage,
    })
    await delegate.emitMessageUpdated?.(message)
  }

  async function persistPendingSteeringMessages() {
    const pending = takePendingSteeringMessages()
    for (const input of pending) {
      const msg = await store.createUserMessage({
        id: input.id,
        convId: conversationId,
        role: 'user',
        status: 'success',
        content: [{ type: 'text', text: input.text }],
        turnId: input.turnId,
      })
      await delegate.emitMessageUpdated?.(msg)
    }
  }

  const emitter: IAgentEventEmitter = {
    async emitTaskUpdated(task) {
      await delegate.emitTaskUpdated(task)
    },
    async emitApprovalRequired(taskId, conversationId, pendingAction) {
      await delegate.emitApprovalRequired(taskId, conversationId, pendingAction)
    },
    async emitTurnStarted(params) {
      const msg = await store.createAssistantMessage({
        conversationId: params.conversationId,
        modelInfo: {
          provider: params.model.provider,
          providerId: params.model.providerId,
          model: params.model.name,
        },
        turnId,
      })
      await delegate.emitMessageUpdated?.(msg)
      turns.set(params.conversationId, newTurnMeta(msg.id))
      await delegate.emitTurnStarted(params)
    },
    async emitTurnChunk(params) {
      const meta = turns.get(params.conversationId)
      if (!meta) {
        await delegate.emitTurnChunk(params)
        return
      }

      meta.modelText = params.accumulatedText
      if (params.chunk.reasoningContent)
        meta.reasoningText += params.chunk.reasoningContent
      if (params.chunk.usage)
        meta.latestUsage = { ...params.chunk.usage }

      const now = Date.now()
      if (now - meta.lastUpdateAt >= STREAM_UPDATE_INTERVAL_MS && (meta.modelText || meta.reasoningText)) {
        meta.lastUpdateAt = now
        await flushTurn(meta)
      }
      await delegate.emitTurnChunk(params)
    },
    async emitTurnToolCalls(params) {
      const meta = turns.get(params.conversationId)
      if (!meta) {
        await delegate.emitTurnToolCalls(params)
        return
      }

      meta.modelText = params.text

      const contentBlocks: MessageContent = []
      if (params.text) {
        contentBlocks.push({ type: 'text', text: params.text })
      }

      for (const tc of params.toolCalls) {
        if (!meta.persistedToolCallIds.has(tc.toolCallId)) {
          meta.persistedToolCallIds.add(tc.toolCallId)
        }
        contentBlocks.push(tc satisfies ToolCallContent)
      }

      const message = await store.updateAssistantMessage(meta.msgId, {
        role: 'assistant',
        status: 'success',
        content: contentBlocks,
      })
      await delegate.emitMessageUpdated?.(message)
      await delegate.emitTurnToolCalls(params)
    },
    async emitTurnToolResults(params) {
      for (const result of params.results) {
        const msg = await store.createToolMessage({
          convId: params.conversationId,
          role: 'tool',
          status: result.isError ? 'error' : 'success',
          content: [result],
          turnId,
        })
        await delegate.emitMessageUpdated?.(msg)
      }

      // steering 必须在工具结果之后持久化，才能保持消息顺序。
      await persistPendingSteeringMessages()

      await delegate.emitTurnToolResults?.(params)
    },
    async emitTurnFinished(params) {
      const meta = turns.get(params.conversationId)
      try {
        if (meta) {
          await flushTurn(meta)
          const content: MessageContent = params.status === 'error'
            ? withErrorContent(meta.modelText, params.text)
            : [{ type: 'text', text: params.text }]
          const message = await store.updateAssistantMessage(meta.msgId, {
            role: 'assistant',
            status: params.status,
            content,
            durationMs: params.durationMs,
          })
          await delegate.emitMessageUpdated?.(message)
        }
      }
      finally {
        turns.delete(params.conversationId)
      }

      // 模型可能不再发起工具调用就结束，因此此处也要刷新 steering。
      await persistPendingSteeringMessages()

      await delegate.emitTurnFinished(params)
    },
  }

  return emitter
}

function withErrorContent(modelText: string, errorText: string): MessageContent {
  const content: MessageContent = modelText.trim()
    ? [{ type: 'text', text: modelText }]
    : []
  content.push({ type: 'error', error: errorText })
  return content
}
