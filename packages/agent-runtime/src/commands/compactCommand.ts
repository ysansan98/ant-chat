import type { AppDataContext } from '@ant-chat/app-data'
import type { ILogger, RunBuiltinCommandResult } from '@ant-chat/shared'
import { compactMessages, createCompactionStrategy, createProvider, estimateContextTokens, getContextWindow } from '@ant-chat/agent-core'
import { messagesToLoopMessages } from './messageConversion'

export async function runCompact(params: {
  appDataContext: AppDataContext
  conversationId: string
  instruction: string | undefined
  modelConfig: { modelId: string, systemPrompt: string, temperature: number, maxTokens: number }
  logger?: ILogger
}): Promise<RunBuiltinCommandResult> {
  const { appDataContext, conversationId, instruction, modelConfig, logger } = params

  function log(msg: string) {
    logger?.info(`[compact] ${msg}`)
  }

  const conversation = await appDataContext.conversationRepository.getById(conversationId)
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`)
  }

  const compactionSettings = conversation.settings?.compaction
  if (!compactionSettings?.enabled) {
    await appDataContext.messageRepository.create({
      convId: conversationId,
      role: 'event',
      status: 'success',
      content: [{ type: 'text', text: 'Context is already compact enough.' }],
      eventType: 'compaction',
    })
    return { summaryText: 'Context is already compact enough.' }
  }

  const messages = await appDataContext.messageRepository.listByConversation(conversationId)
  const loopMessages = messagesToLoopMessages(messages)

  // Get model and provider info for AI provider creation
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

  // Estimate tokens before compaction
  const estimatedTokens = estimateContextTokens(loopMessages)
  const contextWindow = getContextWindow(apiMode)
  const thresholdPercent = compactionSettings.thresholdPercent
  const thresholdTokens = Math.floor(contextWindow * thresholdPercent / 100)

  log(`context check: estimated=${estimatedTokens}, window=${contextWindow}, threshold=${thresholdPercent}% (${thresholdTokens} tokens)`)

  // If under threshold, write "already compact" event
  if (estimatedTokens <= thresholdTokens) {
    await appDataContext.messageRepository.create({
      convId: conversationId,
      role: 'event',
      status: 'success',
      content: [{ type: 'text', text: 'Context is already compact enough.' }],
      eventType: 'compaction',
    })
    return { summaryText: 'Context is already compact enough.' }
  }

  const compactionStrategy = createCompactionStrategy()
  const result = await compactMessages({
    messages: loopMessages,
    preEstimatedTokens: estimatedTokens,
    settings: compactionSettings,
    aiProvider,
    model: modelInfo.model,
    providerFormat: apiMode,
    logger,
    summarize: compactionStrategy.summarize,
    instruction,
  })

  if (!result.compacted) {
    await appDataContext.messageRepository.create({
      convId: conversationId,
      role: 'event',
      status: 'success',
      content: [{ type: 'text', text: 'Context is already compact enough.' }],
      eventType: 'compaction',
    })
    return { summaryText: 'Context is already compact enough.' }
  }

  // Write compaction event message
  await appDataContext.messageRepository.create({
    convId: conversationId,
    role: 'event',
    status: 'success',
    content: [{ type: 'text', text: result.summaryText || '' }],
    eventType: 'compaction',
  })

  // Determine the cut-point timestamp from the original messages so
  // the next turn's context builder only filters summarized messages,
  // not the recently retained ones.
  const keptLength = result.keptLength ?? 0
  const summarizedCount = loopMessages.length - keptLength
  const filteredIndices = messages
    .map((m, i) => (m.role === 'user' || m.role === 'assistant' || m.role === 'tool') ? i : -1)
    .filter(i => i >= 0)
  const firstKeptIndex = summarizedCount > 0 && summarizedCount < filteredIndices.length
    ? filteredIndices[summarizedCount]
    : -1
  const lastCompactedAt = firstKeptIndex >= 0
    ? messages[firstKeptIndex].createdAt
    : messages[messages.length - 1]?.createdAt ?? Date.now()

  await appDataContext.conversationRepository.update({
    id: conversationId,
    settings: {
      ...conversation.settings,
      lastCompactedAt,
      lastCompactionSummary: result.summaryText || '',
    },
  })

  log(`compaction complete: summary=${result.summaryLength} chars, kept=${result.keptLength} msgs, cutAt=${lastCompactedAt}`)

  return { summaryText: result.summaryText }
}
