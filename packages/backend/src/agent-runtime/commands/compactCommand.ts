import type { AIProviderFactory, IAgentEventEmitter, ILogger, RunBuiltinCommandResult } from '@ant-chat/shared'
import type { AppDataContext } from '../../data'
import { buildConversationContextEntries, createCompactionStrategy, createProvider, DEFAULT_COMPACTION_SETTINGS, planCompaction, runCompactionTransaction } from '../../agent-core'

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

  const plan = planCompaction({ messages: loopMessages, settings: compactionSettings, trigger: 'manual' })
  if (!plan.eligible) {
    log(`compaction skipped: reason=${plan.reason}`)
    return { status: 'success', summaryText: '当前上下文不足，无需压缩。' }
  }

  let resolved: Awaited<ReturnType<AppDataContext['modelCatalog']['resolveModel']>>
  let modelInfo: NonNullable<typeof resolved>['model']
  let provider: NonNullable<typeof resolved>['provider']
  try {
    resolved = await appDataContext.modelCatalog.resolveModel({
      providerId: conversation.settings.providerId,
      modelId: modelConfig.modelId,
    })
    if (!resolved) {
      throw new Error(`未找到压缩模型：${modelConfig.modelId}`)
    }
    log(`model found: name=${resolved.model.model}, providerId=${resolved.model.providerId}`)
    modelInfo = resolved.model
    provider = resolved.provider
  }
  catch (err) {
    if (abortSignal?.aborted) {
      return { status: 'cancelled', summaryText: '' }
    }
    const errorMessage = err instanceof Error ? err.message : String(err)
    return { status: 'error', errorMessage, summaryText: errorMessage }
  }
  log(`provider found: apiMode=${provider.apiMode || 'openai'}`)

  const compactionStrategy = createCompactionStrategy()
  let aiProvider: Awaited<ReturnType<NonNullable<AIProviderFactory>>>
  try {
    aiProvider = aiProviderFactory ? await aiProviderFactory({ model: modelInfo, provider }) : await createProvider(provider)
  }
  catch (error) {
    if (abortSignal?.aborted)
      return { status: 'cancelled', summaryText: '' }
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { status: 'error', errorMessage, summaryText: errorMessage }
  }
  const transaction = await runCompactionTransaction({
    trigger: 'manual',
    conversationId,
    contextEntries,
    settings: compactionSettings,
    aiProvider,
    modelName: modelInfo.model,
    modelInfo: { provider: provider.name, providerId: provider.id, model: modelInfo.model },
    summarize: compactionStrategy.summarize,
    instruction,
    abortSignal,
    logger,
    plan,
    persistence: {
      createLoading: async (convId) => {
        const event = await appDataContext.messageRepository.create({ convId, role: 'event', status: 'loading', content: [{ type: 'text', text: '正在压缩上下文...' }], eventType: 'compaction' })
        await eventEmitter.emitMessageUpdated?.(event)
        return event
      },
      update: async (eventId, patch) => {
        const event = await appDataContext.messageRepository.update({ id: eventId, status: patch.status, content: [{ type: 'text', text: patch.text }], modelInfo: patch.modelInfo, usage: patch.usage, compactedThroughMessageId: patch.compactedThroughMessageId })
        await eventEmitter.emitMessageUpdated?.(event)
      },
      delete: async (eventId) => { await appDataContext.messageRepository.delete(eventId) },
    },
  })
  if (transaction.status === 'cancelled')
    return { status: 'cancelled', summaryText: '' }
  if (transaction.status === 'error')
    return { status: 'error', errorMessage: transaction.errorMessage, summaryText: transaction.errorMessage }
  if (transaction.status === 'skipped')
    return { status: 'success', summaryText: '当前上下文不足，无需压缩。' }
  return { status: 'success', summaryText: transaction.summaryText }
}
