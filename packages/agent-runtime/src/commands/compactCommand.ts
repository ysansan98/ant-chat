import type { AppDataContext } from '@ant-chat/app-data'
import type { ILogger, RunBuiltinCommandResult } from '@ant-chat/shared'
import { compactMessages, createCompactionStrategy, createProvider, DEFAULT_COMPACTION_SETTINGS, estimateContextTokens } from '@ant-chat/agent-core'
import { messagesToLoopMessages } from './messageConversion'

export async function runCompact(params: {
  appDataContext: AppDataContext
  conversationId: string
  instruction: string | undefined
  modelConfig: { modelId: string, systemPrompt: string, temperature: number, maxTokens: number }
  logger?: ILogger
  abortSignal?: AbortSignal
}): Promise<RunBuiltinCommandResult> {
  const { appDataContext, conversationId, instruction, modelConfig, logger, abortSignal } = params

  function log(msg: string) {
    logger?.info(`[compact] ${msg}`)
  }

  log(`start: convId=${conversationId}, modelId=${modelConfig.modelId}, hasInstruction=${!!instruction}`)

  const conversation = await appDataContext.conversationRepository.getById(conversationId)
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`)
  }

  const stored = conversation.settings?.compaction
  const compactionSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...(stored ? { keepRecentPairs: stored.keepRecentPairs } : {}),
  }

  const messages = await appDataContext.messageRepository.listByConversation(conversationId)
  const loopMessages = messagesToLoopMessages(messages)
  log(`messages loaded: total=${messages.length}, loopMessages=${loopMessages.length}`)

  // Short-circuit for empty conversations: no compaction needed
  if (loopMessages.length === 0) {
    return { status: 'success', summaryText: 'No messages to compact.' }
  }

  // Create loading event for UI before entering the try block.
  // If this creation itself fails, the error propagates to the caller (infrastructure failure).
  const loadingEvent = await appDataContext.messageRepository.create({
    convId: conversationId,
    role: 'event',
    status: 'loading',
    content: [{ type: 'text', text: 'Compacting context...' }],
    eventType: 'compaction',
  })

  const compactionStrategy = createCompactionStrategy()
  try {
    // Model and provider lookups are inside try/catch so they return error status
    // rather than throwing, for consistent structured error reporting.
    const modelInfo = await appDataContext.modelCatalog.getModelById(modelConfig.modelId)
    if (!modelInfo) {
      throw new Error(`Model not found: ${modelConfig.modelId}`)
    }

    const provider = await appDataContext.modelCatalog.getProviderById(modelInfo.providerId)
    if (!provider) {
      throw new Error(`Provider not found: ${modelInfo.providerId}`)
    }

    const aiProvider = await createProvider(provider)
    const apiMode = provider.apiMode || 'openai'
    log(`aiProvider created: apiMode=${apiMode}`)

    const estimatedTokens = estimateContextTokens(loopMessages)
    log(`context: estimated=${estimatedTokens} tokens`)

    const compactResult = await compactMessages({
      messages: loopMessages,
      preEstimatedTokens: estimatedTokens,
      settings: compactionSettings,
      aiProvider,
      model: modelInfo.model,
      providerFormat: apiMode,
      logger,
      summarize: compactionStrategy.summarize,
      instruction,
      abortSignal,
      force: true,
    })

    // Handle cancellation
    if (abortSignal?.aborted) {
      await appDataContext.messageRepository.delete(loadingEvent.id)
      return { status: 'cancelled', summaryText: '' }
    }

    // Handle compaction failure: no cut point, summarization error, or empty result
    if (!compactResult.compacted || !compactResult.summaryText?.trim()) {
      const errorText = compactResult.summaryError || 'Compaction did not produce a result.'
      await appDataContext.messageRepository.update({
        id: loadingEvent.id,
        status: 'error',
        content: [{ type: 'text', text: errorText }],
      })
      return { status: 'error', summaryText: errorText, errorMessage: errorText }
    }

    // Success: persist summary and update settings
    const { summaryText, summarizedCount } = compactResult

    await appDataContext.conversationRepository.update({
      id: conversationId,
      settings: {
        ...conversation.settings,
        lastCompactedMessageId: loadingEvent.id,
        lastCompactionSummary: summaryText,
      },
    })

    await appDataContext.messageRepository.update({
      id: loadingEvent.id,
      status: 'success',
      content: [{ type: 'text', text: summaryText }],
    })

    log(`compaction complete: summary=${compactResult.summaryLength} chars, summarized=${summarizedCount}, kept=${compactResult.keptLength}, boundary=${loadingEvent.id}`)

    return { status: 'success', summaryText }
  }
  catch (err) {
    // Late cancellation after compactMessages but before abort check
    if (abortSignal?.aborted) {
      log('compaction cancelled by user')
      await appDataContext.messageRepository.delete(loadingEvent.id)
      return { status: 'cancelled', summaryText: '' }
    }
    // Unexpected error (model not found, provider not found, etc.)
    const errorText = err instanceof Error ? err.message : String(err)
    log(`compaction error: ${errorText}`)
    await appDataContext.messageRepository.update({
      id: loadingEvent.id,
      status: 'error',
      content: [{ type: 'text', text: errorText }],
    })
    return { status: 'error', summaryText: errorText, errorMessage: errorText }
  }
}
