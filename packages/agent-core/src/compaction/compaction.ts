import type { CompactionSettingsSchema, IAIProvider, ILogger, LanguageModelUsage, LoopMessage } from '@ant-chat/shared'
import { DEFAULT_COMPACTION_SETTINGS, estimateMessageTokens } from '@ant-chat/shared'

const TOOL_RESULT_MAX_LENGTH = 2000

export { DEFAULT_COMPACTION_SETTINGS }

function defaultLogger(): ILogger {
  return {
    info: (msg: string, ...args: unknown[]) => console.log(`[compaction] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[compaction] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[compaction] ${msg}`, ...args),
  }
}

function findCutPointByTokens(messages: LoopMessage[], keepRecentTokens: number): number {
  const validCutPoints = messages
    .map((message, index) => message.role === 'tool' ? -1 : index)
    .filter(index => index >= 0)

  if (validCutPoints.length === 0) {
    return 0
  }

  let accumulatedTokens = 0
  let cutIndex = validCutPoints[0]

  for (let index = messages.length - 1; index >= 0; index--) {
    accumulatedTokens += estimateMessageTokens(messages[index])
    if (accumulatedTokens >= keepRecentTokens) {
      const nextValidCutPoint = validCutPoints.find(point => point >= index)
      if (nextValidCutPoint !== undefined) {
        cutIndex = nextValidCutPoint
      }
      break
    }
  }

  return cutIndex
}

function serializeMessages(messages: LoopMessage[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    if (msg.role === 'user') {
      for (const part of msg.content) {
        if (part.type === 'text') {
          lines.push(`[user]: ${part.text}`)
        }
      }
    }
    else if (msg.role === 'assistant') {
      for (const part of msg.content) {
        if (part.type === 'text') {
          lines.push(`[assistant]: ${part.text}`)
        }
        else if (part.type === 'tool-call') {
          lines.push(`[assistant tool-call]: ${part.toolName}(${JSON.stringify(part.args)})`)
        }
      }
    }
    else if (msg.role === 'tool') {
      for (const part of msg.content) {
        if (part.type === 'tool-result') {
          const resultStr = typeof part.result === 'string' ? part.result : JSON.stringify(part.result)
          const truncated = resultStr.length > TOOL_RESULT_MAX_LENGTH ? `${resultStr.slice(0, TOOL_RESULT_MAX_LENGTH)}...(truncated)` : resultStr
          const errorTag = part.isError ? ' [ERROR]' : ''
          lines.push(`[tool-result ${part.toolName}${errorTag}]: ${truncated}`)
        }
      }
    }
  }
  return lines.join('\n')
}

export interface CompactionInput {
  messages: LoopMessage[]
  settings: CompactionSettingsSchema
  aiProvider: IAIProvider
  model: string
  abortSignal?: AbortSignal
  logger?: ILogger
  summarize: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal, instruction?: string) => Promise<{
    text: string
    usage?: LanguageModelUsage
  }>
  /** Optional user instruction for what to preserve or ignore during compaction */
  instruction?: string
  trigger?: CompactionTrigger
  contextTokens?: number
  contextLength?: number
  plan?: EligibleCompactionPlan
}

export type CompactionTrigger = 'automatic' | 'manual'
export type CompactionSkipReason = 'disabled' | 'below-threshold' | 'insufficient-history'

export interface EligibleCompactionPlan {
  eligible: true
  cutIndex: number
  toSummarizeCount: number
}

export type CompactionPlan = EligibleCompactionPlan | {
  eligible: false
  reason: CompactionSkipReason
}

export interface CompactionResult {
  messages: LoopMessage[]
  compacted: boolean
  summaryText?: string
  summaryLength?: number
  keptLength?: number
  /** Error message when summarization fails. */
  summaryError?: string
  /** Number of messages included in the summary. */
  summarizedCount?: number
  usage?: LanguageModelUsage
  skipReason?: CompactionSkipReason
}

export function planCompaction(input: {
  messages: LoopMessage[]
  settings: CompactionSettingsSchema
  trigger?: CompactionTrigger
  contextTokens?: number
  contextLength?: number
}): CompactionPlan {
  const { messages, settings, contextTokens, contextLength, trigger = 'automatic' } = input
  if (trigger === 'automatic' && !settings.enabled) {
    return { eligible: false, reason: 'disabled' }
  }

  if (trigger === 'automatic') {
    if (contextTokens === undefined || contextLength === undefined) {
      throw new Error('Automatic compaction requires contextTokens and contextLength.')
    }
    const thresholdTokens = contextLength * settings.thresholdPercent / 100
    if (contextTokens <= thresholdTokens) {
      return { eligible: false, reason: 'below-threshold' }
    }
  }

  const cutIndex = findCutPointByTokens(messages, settings.keepRecentTokens)
  const toSummarizeCount = cutIndex
  const minimumCount = trigger === 'manual' ? 3 : 1
  if (toSummarizeCount < minimumCount) {
    return { eligible: false, reason: 'insufficient-history' }
  }

  return { eligible: true, cutIndex, toSummarizeCount }
}

export async function compactMessages(input: CompactionInput): Promise<CompactionResult> {
  const { messages, settings, aiProvider, model, abortSignal, logger: log = defaultLogger(), summarize, instruction, trigger = 'automatic', contextTokens, contextLength } = input
  const plan = input.plan ?? planCompaction({
    messages,
    settings,
    trigger,
    contextTokens,
    contextLength,
  })
  if (!plan.eligible) {
    log.info(`compaction skipped: reason=${plan.reason}`)
    return { messages, compacted: false, skipReason: plan.reason }
  }

  const { cutIndex } = plan
  const toSummarize = messages.slice(0, cutIndex)
  const toKeep = messages.slice(cutIndex)

  log.info(`compacting: total=${messages.length}, cutIndex=${cutIndex}, summarize=${toSummarize.length}, keep=${toKeep.length}`)

  const serialized = serializeMessages(toSummarize)

  let summaryResult: { text: string, usage?: LanguageModelUsage }
  try {
    summaryResult = await summarize(serialized, aiProvider, model, abortSignal, instruction)
  }
  catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.warn(`summary failed: ${reason}, keeping original messages`)
    return { messages, compacted: false, summaryError: reason }
  }
  const summary = summaryResult.text
  if (!summary.trim()) {
    return {
      messages,
      compacted: false,
      summaryError: '上下文压缩返回了空摘要。',
      usage: summaryResult.usage,
    }
  }

  const summaryMessage: LoopMessage = {
    role: 'user',
    content: [{
      type: 'text',
      // Inject the summary as a user message so later turns can continue from it.
      text: [
        'Previous conversation history has been compressed into the following summary:',
        '<summary>',
        summary,
        '</summary>',
        'Continue the task based on the above summary and subsequent conversation.',
      ].join('\n'),
    }],
  }

  const compactedMessages = [summaryMessage, ...toKeep]

  log.info(`compaction complete: summary=${summary.length} chars, kept=${toKeep.length} msgs, total=${compactedMessages.length}`)

  return {
    messages: compactedMessages,
    compacted: true,
    summaryText: summary,
    summaryLength: summary.length,
    keptLength: toKeep.length,
    summarizedCount: toSummarize.length,
    usage: summaryResult.usage,
  }
}

export { calculateContextTokens, estimateContextTokens } from '@ant-chat/shared'
