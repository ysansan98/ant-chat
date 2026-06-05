import type { CompactionSettingsSchema, IAIProvider, ILogger, ISessionStore, ITaskLogger, LoopMessage } from '@ant-chat/shared'
import { compactMessages, estimateContextTokens } from './compaction'

export function createCompactionGate(params: {
  settings: CompactionSettingsSchema
  aiProvider: IAIProvider | null
  modelName: string
  apiMode: string
  summarize?: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal) => Promise<string>
  logger: ILogger
  taskLogger?: ITaskLogger
  conversationId: string
  userMessageId: string
  store: ISessionStore
}): (ctx: { messages: LoopMessage[], step: number }) => Promise<{ compacted: boolean, messages: LoopMessage[] }> {
  const { settings, aiProvider, modelName, apiMode, summarize, logger, taskLogger, conversationId, userMessageId, store } = params
  let compactionCount = 0

  return async (ctx) => {
    if (!settings.enabled || !aiProvider || !summarize) {
      return { compacted: false, messages: ctx.messages }
    }

    const estimatedTokens = estimateContextTokens(ctx.messages)
    const compResult = await compactMessages({
      messages: ctx.messages,
      preEstimatedTokens: estimatedTokens,
      settings,
      aiProvider,
      model: modelName,
      providerFormat: apiMode,
      logger,
      summarize,
    })

    if (!compResult.compacted) {
      return { compacted: false, messages: ctx.messages }
    }

    compactionCount++

    // Create event message for compaction
    await store.createEventMessage({
      convId: conversationId,
      role: 'event',
      status: 'success',
      content: [{ type: 'text', text: compResult.summaryText || '' }],
      eventType: 'compaction',
      turnId: userMessageId,
    })

    taskLogger?.write('context_compacted', { conversationId, userMessageId, step: ctx.step, compactionCount, summaryLength: compResult.summaryLength, keptLength: compResult.keptLength, totalMessages: compResult.messages.length })

    return { compacted: true, messages: compResult.messages }
  }
}
