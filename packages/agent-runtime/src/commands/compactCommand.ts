import type { AppDataContext } from '@ant-chat/app-data'
import type { ILogger, LanguageModelUsage, RunBuiltinCommandResult } from '@ant-chat/shared'
import { buildConversationContextEntries, compactMessages, createCompactionStrategy, createProvider, DEFAULT_COMPACTION_SETTINGS, estimateContextTokens, planCompaction } from '@ant-chat/agent-core'

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
    throw new Error(`未找到会话：${conversationId}`)
  }
  log(`conversation found: title=${conversation.title}, hasCompactionSettings=${!!conversation.settings?.compaction}`)

  const stored = conversation.settings?.compaction
  const compactionSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...(stored ? { keepRecentPairs: stored.keepRecentPairs } : {}),
  }
  log(`compactionSettings: trigger=manual, keepRecentPairs=${compactionSettings.keepRecentPairs}`)

  const messages = await appDataContext.messageRepository.listByConversation(conversationId)
  log(`messages loaded: total=${messages.length}`)
  const contextEntries = await buildConversationContextEntries(messages)
  const loopMessages = contextEntries.map(entry => entry.message)
  log(`contextMessages built: total=${loopMessages.length}`)
  if (loopMessages.length === 0) {
    return { status: 'success', summaryText: '当前上下文不足，无需压缩。' }
  }

  const estimatedTokens = estimateContextTokens(loopMessages)
  const plan = planCompaction({
    messages: loopMessages,
    settings: compactionSettings,
    trigger: 'manual',
    preEstimatedTokens: estimatedTokens,
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
  const apiMode = provider.apiMode || 'openai'
  log(`provider found: apiMode=${apiMode}`)

  const loadingEvent = await appDataContext.messageRepository.create({
    convId: conversationId,
    role: 'event',
    status: 'loading',
    content: [{ type: 'text', text: '正在压缩上下文...' }],
    eventType: 'compaction',
  })

  let compactionFailed = false
  let errorText = ''
  let summaryText = ''
  let compactionUsage: LanguageModelUsage | undefined

  const compactionStrategy = createCompactionStrategy()
  try {
    const aiProvider = await createProvider(provider)
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
      const compactedThroughMessageId = contextEntries[compactResult.summarizedCount! - 1]?.sourceMessageId
      if (!compactedThroughMessageId) {
        throw new Error('Compaction did not produce a persisted message boundary.')
      }
      await appDataContext.messageRepository.update({
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
    await appDataContext.messageRepository.update({
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
  }
  if (compactionFailed) {
    return { status: 'error', errorMessage: errorText, summaryText: errorText }
  }

  return { status: 'success', summaryText }
}
