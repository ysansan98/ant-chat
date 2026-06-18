import type { AppDataContext } from '@ant-chat/app-data'
import type { AIProviderFactory, IAgentEventEmitter, ILogger, LanguageModelUsage, RunBuiltinCommandResult } from '@ant-chat/shared'
import { buildConversationContextEntries, compactMessages, createCompactionStrategy, createProvider, DEFAULT_COMPACTION_SETTINGS, planCompaction } from '@ant-chat/agent-core'

export async function runCompact(params: {
  appDataContext: AppDataContext
  eventEmitter: IAgentEventEmitter
  conversationId: string
  instruction: string | undefined
  modelConfig: { modelId: string, systemPrompt: string, temperature: number, maxTokens: number }
  logger?: ILogger
  aiProviderFactory?: AIProviderFactory
  abortSignal?: AbortSignal
}): Promise<RunBuiltinCommandResult> {
  const { appDataContext, eventEmitter, conversationId, instruction, modelConfig, logger, aiProviderFactory, abortSignal } = params

  function log(msg: string) {
    logger?.info(`[compact] ${msg}`)
  }

  log(`start: convId=${conversationId}, modelId=${modelConfig.modelId}, hasInstruction=${!!instruction}`)

  const conversation = await appDataContext.conversationRepository.getById(conversationId)
  if (!conversation) {
    throw new Error(`未找到会话：${conversationId}`)
  }
  log(`conversation found: title=${conversation.title}, hasCompactionSettings=${!!conversation.settings?.compaction}`)

  const stored = conversation.settings?.compaction
  const compactionSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...(stored ? { keepRecentTokens: stored.keepRecentTokens } : {}),
  }
  log(`compactionSettings: trigger=manual, keepRecentTokens=${compactionSettings.keepRecentTokens}`)

  const messages = await appDataContext.messageRepository.listByConversation(conversationId)
  log(`messages loaded: total=${messages.length}`)
  const contextEntries = await buildConversationContextEntries(messages)
  const loopMessages = contextEntries.map(entry => entry.message)
  log(`contextMessages built: total=${loopMessages.length}`)
  if (loopMessages.length === 0) {
    return { status: 'success', summaryText: '当前上下文不足，无需压缩。' }
  }

  const plan = planCompaction({
    messages: loopMessages,
    settings: compactionSettings,
    trigger: 'manual',
  })
  if (!plan.eligible) {
    log(`compaction skipped: reason=${plan.reason}`)
    return { status: 'success', summaryText: '当前上下文不足，无需压缩。' }
  }

  let modelInfo: Awaited<ReturnType<AppDataContext['modelCatalog']['getModelById']>>
  let provider: Awaited<ReturnType<AppDataContext['modelCatalog']['getProviderById']>>
  try {
    modelInfo = await appDataContext.modelCatalog.getModelById(modelConfig.modelId)
    if (!modelInfo) {
      throw new Error(`未找到压缩模型：${modelConfig.modelId}`)
    }
    log(`model found: name=${modelInfo.model}, providerId=${modelInfo.providerId}`)

    provider = await appDataContext.modelCatalog.getProviderById(modelInfo.providerId)
    if (!provider) {
      throw new Error(`未找到模型对应的 Provider：${modelInfo.providerId}`)
    }
  }
  catch (err) {
    if (abortSignal?.aborted) {
      return { status: 'cancelled', summaryText: '' }
    }
    const errorMessage = err instanceof Error ? err.message : String(err)
    return { status: 'error', errorMessage, summaryText: errorMessage }
  }
  log(`provider found: apiMode=${provider.apiMode || 'openai'}`)

  const loadingEvent = await appDataContext.messageRepository.create({
    convId: conversationId,
    role: 'event',
    status: 'loading',
    content: [{ type: 'text', text: '正在压缩上下文...' }],
    eventType: 'compaction',
  })
  await eventEmitter.emitMessageUpdated?.(loadingEvent)

  let compactionFailed = false
  let errorText = ''
  let summaryText = ''
  let compactionUsage: LanguageModelUsage | undefined

  const compactionStrategy = createCompactionStrategy()
  try {
    const aiProvider = aiProviderFactory
      ? await aiProviderFactory({ model: modelInfo, provider })
      : await createProvider(provider)
    log(`aiProvider created`)
    const compactResult = await compactMessages({
      messages: loopMessages,
      settings: compactionSettings,
      aiProvider,
      model: modelInfo.model,
      logger,
      summarize: compactionStrategy.summarize,
      instruction,
      abortSignal,
      trigger: 'manual',
      plan,
    })
    compactionUsage = compactResult.usage

    if (abortSignal?.aborted) {
      await appDataContext.messageRepository.delete(loadingEvent.id)
      return { status: 'cancelled', summaryText: '' }
    }

    if (!compactResult.compacted) {
      compactionFailed = true
      errorText = compactResult.summaryError || '上下文压缩未生成结果。'
    }
    else if (!compactResult.summaryText?.trim()) {
      compactionFailed = true
      errorText = '上下文压缩返回了空摘要。'
    }
    else {
      summaryText = compactResult.summaryText
      const compactedThroughMessageId = contextEntries[plan.toSummarizeCount - 1]?.sourceMessageId
      if (!compactedThroughMessageId) {
        throw new Error('Compaction did not produce a persisted message boundary.')
      }
      const completedEvent = await appDataContext.messageRepository.update({
        id: loadingEvent.id,
        status: 'success',
        content: [{ type: 'text', text: summaryText }],
        modelInfo: {
          provider: provider.name,
          providerId: provider.id,
          model: modelInfo.model,
        },
        usage: compactResult.usage,
        compactedThroughMessageId,
      })
      await eventEmitter.emitMessageUpdated?.(completedEvent)
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

  if (compactionFailed) {
    const failedEvent = await appDataContext.messageRepository.update({
      id: loadingEvent.id,
      status: 'error',
      content: [{ type: 'text', text: errorText }],
      modelInfo: {
        provider: provider.name,
        providerId: provider.id,
        model: modelInfo.model,
      },
      usage: compactionUsage,
    })
    await eventEmitter.emitMessageUpdated?.(failedEvent)
  }
  if (compactionFailed) {
    return { status: 'error', errorMessage: errorText, summaryText: errorText }
  }

  return { status: 'success', summaryText }
}
