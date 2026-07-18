import type { CompactionSettingsSchema, IAIProvider, ILogger, LanguageModelUsage, LoopMessage, ModelInfo } from '@ant-chat/shared'
import type { ConversationContextEntry } from '../loop/loopContext'
import type { CompactionSkipReason, CompactionTrigger } from './compaction'
import { calculateContextTokens, compactMessages, planCompaction } from './compaction'

export interface CompactionEventPersistence {
  createLoading: (conversationId: string) => Promise<{ id: string }>
  update: (eventId: string, patch: {
    status: 'success' | 'error'
    text: string
    modelInfo: ModelInfo
    usage?: LanguageModelUsage
    compactedThroughMessageId?: string
  }) => Promise<void>
  delete: (eventId: string) => Promise<void>
}

export type CompactionTransactionResult
  = | { status: 'skipped', messages: LoopMessage[], reason: CompactionSkipReason }
    | { status: 'cancelled', messages: LoopMessage[] }
    | { status: 'error', messages: LoopMessage[], errorMessage: string, usage?: LanguageModelUsage }
    | { status: 'compacted', messages: LoopMessage[], summaryText: string, compactedThroughMessageId: string, usage?: LanguageModelUsage }

export async function runCompactionTransaction(input: {
  trigger: CompactionTrigger
  conversationId: string
  contextEntries: ConversationContextEntry[]
  pendingUserMessage?: LoopMessage
  settings: CompactionSettingsSchema
  prepare: () => Promise<{
    aiProvider: IAIProvider
    modelName: string
    modelInfo: ModelInfo
  }>
  summarize: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal, instruction?: string) => Promise<{ text: string, usage?: LanguageModelUsage }>
  persistence: CompactionEventPersistence
  contextLength?: number
  instruction?: string
  abortSignal?: AbortSignal
  logger?: ILogger
}): Promise<CompactionTransactionResult> {
  const messages = input.contextEntries.map(entry => entry.message)
  const contextTokens = input.trigger === 'automatic' && input.pendingUserMessage
    ? calculateContextTokens(input.contextEntries, input.pendingUserMessage)
    : undefined
  const plan = planCompaction({
    messages,
    settings: input.settings,
    trigger: input.trigger,
    contextTokens,
    contextLength: input.contextLength,
  })
  if (!plan.eligible) {
    return { status: 'skipped', messages, reason: plan.reason }
  }

  let prepared: Awaited<ReturnType<typeof input.prepare>>
  try {
    prepared = await input.prepare()
  }
  catch (error) {
    if (input.abortSignal?.aborted)
      return { status: 'cancelled', messages }
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { status: 'error', messages, errorMessage }
  }
  if (input.abortSignal?.aborted)
    return { status: 'cancelled', messages }

  const loadingEvent = await input.persistence.createLoading(input.conversationId)
  try {
    const result = await compactMessages({
      messages,
      settings: input.settings,
      aiProvider: prepared.aiProvider,
      model: prepared.modelName,
      logger: input.logger,
      summarize: input.summarize,
      instruction: input.instruction,
      abortSignal: input.abortSignal,
      trigger: input.trigger,
      contextTokens,
      contextLength: input.contextLength,
      plan,
    })
    if (input.abortSignal?.aborted) {
      await input.persistence.delete(loadingEvent.id)
      return { status: 'cancelled', messages }
    }
    if (!result.compacted || !result.summaryText?.trim()) {
      const errorMessage = result.summaryError || '上下文压缩未生成结果。'
      await input.persistence.update(loadingEvent.id, { status: 'error', text: errorMessage, modelInfo: prepared.modelInfo, usage: result.usage })
      return { status: 'error', messages, errorMessage, usage: result.usage }
    }
    const compactedThroughMessageId = input.contextEntries[plan.toSummarizeCount - 1]?.sourceMessageId
    if (!compactedThroughMessageId) {
      const errorMessage = 'Compaction did not produce a persisted message boundary.'
      await input.persistence.update(loadingEvent.id, { status: 'error', text: errorMessage, modelInfo: prepared.modelInfo, usage: result.usage })
      return { status: 'error', messages, errorMessage, usage: result.usage }
    }
    await input.persistence.update(loadingEvent.id, {
      status: 'success',
      text: result.summaryText,
      modelInfo: prepared.modelInfo,
      usage: result.usage,
      compactedThroughMessageId,
    })
    return { status: 'compacted', messages: result.messages, summaryText: result.summaryText, compactedThroughMessageId, usage: result.usage }
  }
  catch (error) {
    if (input.abortSignal?.aborted) {
      await input.persistence.delete(loadingEvent.id)
      return { status: 'cancelled', messages }
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    await input.persistence.update(loadingEvent.id, { status: 'error', text: errorMessage, modelInfo: prepared.modelInfo })
    return { status: 'error', messages, errorMessage }
  }
}
