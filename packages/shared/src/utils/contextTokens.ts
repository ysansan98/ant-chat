import type { LanguageModelUsage } from '../schemas/messages'

/**
 * Estimate token count for a text string.
 * Uses a simple heuristic: ~4 characters per token.
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Generic message interface for token estimation.
 * Compatible with both LoopMessage and IMessage content structures.
 */
interface TokenizableMessage {
  role: string
  content: Array<Record<string, unknown>>
}

/**
 * Estimate token count for a single message.
 */
export function estimateMessageTokens(msg: TokenizableMessage): number {
  let total = 0
  for (const part of msg.content) {
    const type = part.type as string
    if (type === 'text') {
      total += estimateTextTokens((part.text as string) || '')
    }
    else if (type === 'tool-call') {
      total += estimateTextTokens((part.toolName as string) || '')
        + estimateTextTokens(JSON.stringify(part.args ?? {}))
        + 10
    }
    else if (type === 'tool-result') {
      const resultStr = typeof part.result === 'string' ? part.result : JSON.stringify(part.result ?? '')
      total += estimateTextTokens(resultStr) + 10
    }
    else if (type === 'error') {
      total += estimateTextTokens((part.error as string) || '')
    }
    // image, image-block, document, file: skip token estimation for non-text content
  }
  return total + 4
}

/**
 * Estimate total token count for an array of messages.
 */
export function estimateContextTokens(messages: TokenizableMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
}

/**
 * Entry for context token calculation.
 */
export interface ContextTokenEntry {
  message: TokenizableMessage
  usage?: LanguageModelUsage
  status?: string
}

/**
 * Get total tokens from a usage object.
 */
function getUsageTokens(usage: LanguageModelUsage | undefined): number {
  if (!usage) {
    return 0
  }
  if (usage.totalTokens !== undefined) {
    return usage.totalTokens
  }
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}

/**
 * Calculate current context token count.
 *
 * Strategy:
 * 1. Find the last assistant message with usage data
 * 2. Use its totalTokens as the base (this reflects actual API-reported context size)
 * 3. Add estimated tokens for any trailing messages after it
 * 4. Add estimated tokens for the pending user message
 *
 * Falls back to pure estimation if no assistant message with usage is found.
 */
export function calculateContextTokens(
  entries: ContextTokenEntry[],
  pendingUserMessage?: TokenizableMessage,
): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry.message.role !== 'assistant' || entry.status !== 'success') {
      continue
    }
    const usageTokens = getUsageTokens(entry.usage)
    if (usageTokens <= 0) {
      continue
    }
    const trailingMessages = entries.slice(index + 1).map(item => item.message)
    return usageTokens
      + estimateContextTokens(trailingMessages)
      + (pendingUserMessage ? estimateContextTokens([pendingUserMessage]) : 0)
  }

  return estimateContextTokens([
    ...entries.map(entry => entry.message),
    ...(pendingUserMessage ? [pendingUserMessage] : []),
  ])
}
