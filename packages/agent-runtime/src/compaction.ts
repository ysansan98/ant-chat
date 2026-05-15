import type { CompactionSettingsSchema, IAIProvider, ILogger, LoopMessage } from '@ant-chat/shared'

const CONTEXT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  deepseek: 128_000,
  openai: 128_000,
  google: 1_000_000,
}

const DEFAULT_CONTEXT_WINDOW = 128_000
const TOOL_RESULT_MAX_LENGTH = 2000

export const DEFAULT_COMPACTION_SETTINGS: Readonly<CompactionSettingsSchema> = Object.freeze({
  enabled: true,
  thresholdPercent: 70,
  keepRecentPairs: 3,
})

function defaultLogger(): ILogger {
  return {
    info: (msg: string, ...args: unknown[]) => console.log(`[compaction] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[compaction] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[compaction] ${msg}`, ...args),
  }
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessageTokens(msg: LoopMessage): number {
  let total = 0
  for (const part of msg.content) {
    if (part.type === 'text') {
      total += estimateTextTokens(part.text)
    }
    else if (part.type === 'tool-call') {
      total += estimateTextTokens(JSON.stringify(part.args)) + 10
    }
    else if (part.type === 'tool-result') {
      const resultStr = typeof part.result === 'string' ? part.result : JSON.stringify(part.result)
      total += estimateTextTokens(resultStr) + 10
    }
  }
  return total + 4
}

function estimateContextTokens(messages: LoopMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
}

function getContextWindow(providerFormat: string): number {
  return CONTEXT_WINDOWS[providerFormat] ?? DEFAULT_CONTEXT_WINDOW
}

function findCutPointByPairs(messages: LoopMessage[], keepRecentPairs: number): number {
  let userCount = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userCount++
      if (userCount >= keepRecentPairs) {
        return i
      }
    }
  }

  return 0
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
  providerFormat: string
  abortSignal?: AbortSignal
  logger?: ILogger
  summarize: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal) => Promise<string>
  /** Pre-computed token estimate to avoid double computation */
  preEstimatedTokens?: number
}

export interface CompactionResult {
  messages: LoopMessage[]
  compacted: boolean
  summaryText?: string
  summaryLength?: number
  keptLength?: number
}

export async function compactMessages(input: CompactionInput): Promise<CompactionResult> {
  const { messages, settings, aiProvider, model, providerFormat, abortSignal, logger: log = defaultLogger(), summarize, preEstimatedTokens } = input

  if (!settings.enabled) {
    return { messages, compacted: false }
  }

  const estimatedTokens = preEstimatedTokens ?? estimateContextTokens(messages)
  const contextWindow = getContextWindow(providerFormat)
  const thresholdTokens = Math.floor(contextWindow * settings.thresholdPercent / 100)

  log.info(`context check: estimated=${estimatedTokens}, window=${contextWindow}, threshold=${settings.thresholdPercent}% (${thresholdTokens} tokens)`)

  if (estimatedTokens <= thresholdTokens) {
    return { messages, compacted: false }
  }

  const cutIndex = findCutPointByPairs(messages, settings.keepRecentPairs)
  if (cutIndex <= 0) {
    log.warn('no safe cut point found, skipping compaction')
    return { messages, compacted: false }
  }

  const toSummarize = messages.slice(0, cutIndex)
  const toKeep = messages.slice(cutIndex)

  log.info(`compacting: total=${messages.length}, cutIndex=${cutIndex}, summarize=${toSummarize.length}, keep=${toKeep.length}`)

  const serialized = serializeMessages(toSummarize)

  let summary: string
  try {
    summary = await summarize(serialized, aiProvider, model, abortSignal)
  }
  catch {
    log.warn('summary failed, keeping original messages')
    return { messages, compacted: false }
  }

  const summaryMessage: LoopMessage = {
    role: 'user',
    content: [{
      type: 'text',
      // 将压缩摘要注入为一条 user 消息，供模型后续对话参考
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
  }
}

export { estimateContextTokens, getContextWindow }
