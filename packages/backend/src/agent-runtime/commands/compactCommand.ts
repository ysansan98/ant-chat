import type { AIProviderFactory, IAgentEventEmitter, IHookDispatcher, ILogger, ReasoningEffortLevel, RunBuiltinCommandResult } from '@ant-chat/shared'
import type { AppDataContext } from '../../data'
import { buildConversationContextEntries, createCompactionStrategy, createProvider, DEFAULT_COMPACTION_SETTINGS, runCompactionTransaction } from '../../agent-core'
import { runPostCompactHook, runPreCompactHook } from '../../agent-core/hooks/lifecycleHooks'

export async function runCompact(params: {
  appDataContext: AppDataContext
  eventEmitter: IAgentEventEmitter
  conversationId: string
  instruction: string | undefined
  modelConfig: { modelId: string, reasoningEffort?: ReasoningEffortLevel }
  logger?: ILogger
  aiProviderFactory?: AIProviderFactory
  hooks?: IHookDispatcher
  abortSignal?: AbortSignal
}): Promise<RunBuiltinCommandResult> {
  const { appDataContext, eventEmitter, conversationId, instruction, modelConfig, logger, aiProviderFactory, hooks, abortSignal } = params
  const hookConfig = { hooks, logger }

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

  // PreCompact hook：deny 或 continue:false 阻止本次手动压缩。
  const preCompact = await runPreCompactHook({
    config: hookConfig,
    conversationId,
    workspacePath: conversation.workspacePath ?? '',
    trigger: 'manual',
    signal: abortSignal,
  })
  if (!preCompact.allowed) {
    log(`compaction blocked by hook: ${preCompact.reason ?? 'no reason'}`)
    await runPostCompactHook({
      config: hookConfig,
      conversationId,
      workspacePath: conversation.workspacePath ?? '',
      trigger: 'manual',
      status: 'blocked',
    })
    return { status: 'success', summaryText: `上下文压缩已被 hook 阻止${preCompact.reason ? `：${preCompact.reason}` : '。'}` }
  }

  const compactionStrategy = createCompactionStrategy(modelConfig.reasoningEffort, conversationId)
  const transaction = await runCompactionTransaction({
    trigger: 'manual',
    conversationId,
    contextEntries,
    settings: compactionSettings,
    prepare: async () => {
      const resolved = await appDataContext.modelCatalog.resolveModel({
        providerId: conversation.settings.providerId,
        modelId: modelConfig.modelId,
      })
      if (!resolved)
        throw new Error(`未找到压缩模型：${modelConfig.modelId}`)
      log(`model found: name=${resolved.model.model}, providerId=${resolved.model.providerId}`)
      log(`provider found: apiMode=${resolved.provider.apiMode || 'openai'}`)
      return {
        aiProvider: aiProviderFactory ? await aiProviderFactory({ model: resolved.model, provider: resolved.provider }) : await createProvider(resolved.provider),
        modelName: resolved.model.model,
        modelInfo: { provider: resolved.provider.name, providerId: resolved.provider.id, model: resolved.model.model },
      }
    },
    summarize: compactionStrategy.summarize,
    instruction,
    abortSignal,
    logger,
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
  await runPostCompactHook({
    config: hookConfig,
    conversationId,
    workspacePath: conversation.workspacePath ?? '',
    trigger: 'manual',
    status: transaction.status,
    summaryText: transaction.status === 'compacted' ? transaction.summaryText : undefined,
  })
  if (transaction.status === 'cancelled')
    return { status: 'cancelled', summaryText: '' }
  if (transaction.status === 'error')
    return { status: 'error', errorMessage: transaction.errorMessage, summaryText: transaction.errorMessage }
  if (transaction.status === 'skipped')
    return { status: 'success', summaryText: '当前上下文不足，无需压缩。' }
  return { status: 'success', summaryText: transaction.summaryText }
}
