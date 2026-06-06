import type { IMessage } from '@ant-chat/shared'
import type { LanguageModelUsage } from 'ai'

export function calculateSessionUsage(messages: IMessage[]): LanguageModelUsage | undefined {
  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let cachedInputTokens = 0

  for (const message of messages) {
    if (!message.usage) {
      continue
    }
    inputTokens += message.usage.inputTokens ?? 0
    outputTokens += message.usage.outputTokens ?? 0
    reasoningTokens += message.usage.reasoningTokens ?? 0
    cachedInputTokens += message.usage.cachedInputTokens ?? 0
  }

  const totalTokens = inputTokens + outputTokens + reasoningTokens + cachedInputTokens
  if (totalTokens === 0) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cachedInputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: {
      reasoningTokens: undefined,
      textTokens: undefined,
    },
  }
}
