import type { IAIProvider, ILogger, LoopMessage } from '@ant-chat/shared'

const CONTEXT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  deepseek: 128_000,
  openai: 128_000,
  google: 1_000_000,
}

const DEFAULT_CONTEXT_WINDOW = 128_000

export interface CompactionSettings {
  enabled: boolean
  reserveTokens: number
  thresholdPercent: number
  keepRecentPairs: number
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 4096,
  thresholdPercent: 70,
  keepRecentPairs: 3,
}

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
          const truncated = resultStr.length > 2000 ? `${resultStr.slice(0, 2000)}...(truncated)` : resultStr
          const errorTag = part.isError ? ' [ERROR]' : ''
          lines.push(`[tool-result ${part.toolName}${errorTag}]: ${truncated}`)
        }
      }
    }
  }
  return lines.join('\n')
}

const SUMMARIZATION_SYSTEM_PROMPT = `You compress prior agent conversation history so the task can continue accurately.

Summarize only the provided conversation. Do not infer facts that are not present.
If a section has no evidence, write "None" or "Unknown".

Output exactly these sections:

## User goal
The user's final objective and any explicit constraints or preferences that still apply.

## Completed work
Concrete completed actions only. Include changed files, commands run, command results, and verification status.

## Current state
What the agent was doing when this history ended. Include pending edits, running commands, unresolved errors, and blockers.

## Decisions
Important implementation decisions and the reason recorded in the conversation.

## Next actions
Actionable next steps needed to continue the task.

## Critical context
Preserve exact file paths, commands, identifiers, versions, ports, URLs, error messages, test names, branch names, commit hashes, and user instructions.

Rules:
- Preserve exact literals. Do not rewrite paths, commands, identifiers, or error messages.
- Do not mark planned work as completed.
- Do not omit failing checks or unverified work.
- Do not include commentary before or after the summary.`

async function generateSummary(
  serialized: string,
  aiProvider: IAIProvider,
  model: string,
  reserveTokens: number,
  abortSignal?: AbortSignal,
): Promise<string> {
  const maxSummaryTokens = Math.max(1024, Math.floor(reserveTokens * 0.8))
  const userMessage = [
    'Compress the following prior conversation history into a structured continuation summary:',
    '',
    '<conversation>',
    serialized,
    '</conversation>',
  ].join('\n')

  const result = await aiProvider.complete({
    messages: [{ role: 'user', content: userMessage }],
    chatSettings: {
      model,
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      maxTokens: maxSummaryTokens,
    },
    abortSignal,
  })
  return result.text
}

export interface CompactionInput {
  messages: LoopMessage[]
  settings: CompactionSettings
  aiProvider: IAIProvider
  model: string
  providerFormat: string
  abortSignal?: AbortSignal
  logger?: ILogger
}

export interface CompactionResult {
  messages: LoopMessage[]
  compacted: boolean
  summaryText?: string
  summaryLength?: number
  keptLength?: number
}

export async function compactMessages(input: CompactionInput): Promise<CompactionResult> {
  const { messages, settings, aiProvider, model, providerFormat, abortSignal, logger: log = defaultLogger() } = input

  if (!settings.enabled) {
    return { messages, compacted: false }
  }

  const estimatedTokens = estimateContextTokens(messages)
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
    summary = await generateSummary(serialized, aiProvider, model, settings.reserveTokens, abortSignal)
  }
  catch {
    log.warn('summary failed, keeping original messages')
    return { messages, compacted: false }
  }

  const summaryMessage: LoopMessage = {
    role: 'user',
    content: [{
      type: 'text',
      text: [
        '之前的对话历史已压缩为以下摘要：',
        '<summary>',
        summary,
        '</summary>',
        '请基于以上摘要和后续对话继续完成任务。',
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
