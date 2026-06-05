import type { AppDataContext } from '@ant-chat/app-data'
import type { ILogger, RunBuiltinCommandResult } from '@ant-chat/shared'
import { buildConversationContextMessages, compactMessages, createCompactionStrategy, createProvider, DEFAULT_COMPACTION_SETTINGS, estimateContextTokens } from '@ant-chat/agent-core'

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
  log(`conversation found: title=${conversation.title}, hasCompactionSettings=${!!conversation.settings?.compaction}`)

  const stored = conversation.settings?.compaction
  const compactionSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...(stored ? { keepRecentPairs: stored.keepRecentPairs } : {}),
  }
  log(`compactionSettings: force=true, keepRecentPairs=${compactionSettings.keepRecentPairs}`)

  const messages = await appDataContext.messageRepository.listByConversation(conversationId)
  log(`messages loaded: total=${messages.length}`)
  const loopMessages = await buildConversationContextMessages(messages)
  log(`contextMessages built: total=${loopMessages.length}`)
  if (loopMessages.length === 0) {
    return { status: 'success', summaryText: 'No messages to compact.' }
  }

  const estimatedTokens = estimateContextTokens(loopMessages)
  log(`context check: estimated=${estimatedTokens}, force=true`)

  log(`invoking LLM compaction...`)

  // Create a loading event that the UI can render immediately after messages refresh
  const loadingEvent = await appDataContext.messageRepository.create({
    convId: conversationId,
    role: 'event',
    status: 'loading',
    content: [{ type: 'text', text: 'Compacting context...' }],
    eventType: 'compaction',
  })

  let compactionFailed = false
  let errorText = ''
  let summaryText = ''

  const compactionStrategy = createCompactionStrategy()
  try {
    const modelInfo = await appDataContext.modelCatalog.getModelById(modelConfig.modelId)
    if (!modelInfo) {
      throw new Error(`Model not found: ${modelConfig.modelId}`)
    }
    log(`model found: name=${modelInfo.model}, providerId=${modelInfo.providerId}`)

    const provider = await appDataContext.modelCatalog.getProviderById(modelInfo.providerId)
    if (!provider) {
      throw new Error(`Provider not found: ${modelInfo.providerId}`)
    }
    log(`provider found: apiMode=${provider.apiMode || 'openai'}`)

    const aiProvider = await createProvider(provider)
    const apiMode = provider.apiMode || 'openai'
    log(`aiProvider created`)

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

    if (abortSignal?.aborted) {
      await appDataContext.messageRepository.delete(loadingEvent.id)
      return { status: 'cancelled', summaryText: '' }
    }

    if (!compactResult.compacted) {
      compactionFailed = true
      errorText = compactResult.summaryError || 'Compaction did not produce a result.'
    }
    else if (!compactResult.summaryText?.trim()) {
      compactionFailed = true
      errorText = 'Compaction summarization returned empty response.'
    }
    else {
      summaryText = compactResult.summaryText
      log(`compaction complete: summary=${compactResult.summaryLength} chars, kept=${compactResult.keptLength} msgs`)
    }
  }
  catch (err) {
    if (abortSignal?.aborted) {
      log('compaction cancelled by user')
      await appDataContext.messageRepository.delete(loadingEvent.id)
      return { status: 'cancelled', summaryText: '' }
    }
    compactionFailed = true
    errorText = err instanceof Error ? err.message : String(err)
  }

  // Update the loading event to its final state
  if (compactionFailed) {
    await appDataContext.messageRepository.update({
      id: loadingEvent.id,
      status: 'error',
      content: [{ type: 'text', text: errorText }],
    })
  }
  else {
    await appDataContext.messageRepository.update({
      id: loadingEvent.id,
      status: 'success',
      content: [{ type: 'text', text: summaryText }],
    })
  }

  if (compactionFailed) {
    return { status: 'error', errorMessage: errorText, summaryText: errorText }
  }

  return { status: 'success', summaryText }
}
