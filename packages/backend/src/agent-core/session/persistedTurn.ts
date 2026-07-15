import type { IAgentEventEmitter, ISessionStore, MessageContent, ToolCallContent, VisualizationBlock } from '@ant-chat/shared'
import { VisualizationBlockSchema, VisualizationOutputBlocksSchema } from '@ant-chat/shared'

const STREAM_UPDATE_INTERVAL_MS = 80

interface TurnMeta {
  msgId: string
  modelText: string
  reasoningText: string
  latestUsage: Record<string, number> | undefined
  lastUpdateAt: number
  persistedToolCallIds: Set<string>
  visualizationBlock?: VisualizationBlock
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
      visualizationBlock: undefined,
    }
  }

  async function flushTurn(meta: TurnMeta) {
    const message = await store.updateAssistantMessage(meta.msgId, {
      role: 'assistant',
      status: 'loading',
      content: createAssistantContent(meta.modelText.trim() || '...'),
      reasoningContent: meta.reasoningText,
      usage: meta.latestUsage,
    })
    replacePersistedVisualizationBlocks(meta, message)
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
      const previousVisualizationBlock = turns.get(params.conversationId)?.visualizationBlock
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
      turns.set(params.conversationId, {
        ...newTurnMeta(msg.id),
        visualizationBlock: previousVisualizationBlock,
      })
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

      const contentBlocks: ToolCallContent[] = []

      const safeToolCalls = params.toolCalls.map(stripVisualizationTransport)
      for (const tc of params.toolCalls) {
        if (!meta.persistedToolCallIds.has(tc.toolCallId)) {
          meta.persistedToolCallIds.add(tc.toolCallId)
        }
        contentBlocks.push(stripVisualizationTransport(tc))
        replaceVisualizationBlock(meta, extractVisualizationBlocks(tc))
      }

      const message = await store.updateAssistantMessage(meta.msgId, {
        role: 'assistant',
        status: 'success',
        content: createAssistantContent(params.text, undefined, contentBlocks),
      })
      replacePersistedVisualizationBlocks(meta, message)
      await delegate.emitMessageUpdated?.(message)
      await delegate.emitTurnToolCalls({ ...params, toolCalls: safeToolCalls })
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
            ? withErrorContent(meta.modelText, params.text, meta.visualizationBlock)
            : createAssistantContent(params.text, meta.visualizationBlock)
          const message = await store.updateAssistantMessage(meta.msgId, {
            role: 'assistant',
            status: params.status,
            content,
            durationMs: params.durationMs,
          })
          replacePersistedVisualizationBlocks(meta, message)
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

function stripVisualizationTransport(toolCall: ToolCallContent): ToolCallContent {
  const { outputBlocks: _outputBlocks, ...safeToolCall } = toolCall
  return safeToolCall
}

function withErrorContent(modelText: string, errorText: string, visualizationBlock?: VisualizationBlock): MessageContent {
  const content: MessageContent = modelText.trim()
    ? [{ type: 'text', text: modelText }]
    : []
  if (visualizationBlock)
    content.push(visualizationBlock)
  content.push({ type: 'error', error: errorText })
  return content
}

function createAssistantContent(
  text: string,
  visualizationBlock?: VisualizationBlock,
  toolCalls: ToolCallContent[] = [],
): MessageContent {
  const content: MessageContent = text.trim()
    ? [{ type: 'text', text }]
    : []
  if (visualizationBlock)
    content.push(visualizationBlock)
  content.push(...toolCalls)
  return content
}

function extractVisualizationBlocks(value: unknown): VisualizationBlock[] {
  const outputBlocks = value && typeof value === 'object' && !Array.isArray(value)
    && 'outputBlocks' in value
    ? value.outputBlocks
    : undefined
  const parsed = VisualizationOutputBlocksSchema.safeParse({ outputBlocks })
  return parsed.success ? parsed.data.outputBlocks : []
}

function replaceVisualizationBlock(meta: TurnMeta, blocks: VisualizationBlock[]): void {
  const latest = blocks[blocks.length - 1]
  if (latest)
    meta.visualizationBlock = latest
}

function replacePersistedVisualizationBlocks(meta: TurnMeta, message: unknown): void {
  if (!message || typeof message !== 'object' || !Array.isArray((message as { content?: unknown }).content)) {
    return
  }
  const blocks = ((message as { content: unknown[] }).content).flatMap((block) => {
    const parsed = VisualizationBlockSchema.safeParse(block)
    return parsed.success ? [parsed.data] : []
  })
  if (blocks.length > 0)
    meta.visualizationBlock = blocks[blocks.length - 1]
}
