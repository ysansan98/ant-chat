import type { CompactionSettingsSchema, IAgentEventEmitter, IAIProvider, ILogger, LoopMessage } from '@ant-chat/shared'
import { compactMessages, estimateContextTokens } from './compaction'

export function createCompactionGate(params: {
  settings: CompactionSettingsSchema
  aiProvider: IAIProvider | null
  modelName: string
  apiMode: string
  summarize?: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal) => Promise<string>
  eventEmitter: IAgentEventEmitter
  logger: ILogger
  conversationId: string
  userMessageId: string
}): (ctx: { messages: LoopMessage[], step: number }) => Promise<{ messages: LoopMessage[] }> {
  const { settings, aiProvider, modelName, apiMode, summarize, eventEmitter, logger, conversationId, userMessageId } = params
  let compactionCount = 0

  return async (ctx) => {
    if (!settings.enabled || !aiProvider || !summarize) {
      return { messages: ctx.messages }
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
      return { messages: ctx.messages }
    }

    compactionCount++
    await eventEmitter.emitCompactionSaved({
      conversationId,
      summary: compResult.summaryText || '',
      compactedAt: Date.now(),
    })

    logger.info('[agent-runtime]', { event: 'context_compacted', conversationId, userMessageId, step: ctx.step, compactionCount, summaryLength: compResult.summaryLength, keptLength: compResult.keptLength, totalMessages: compResult.messages.length })

    return { messages: compResult.messages }
  }
}
