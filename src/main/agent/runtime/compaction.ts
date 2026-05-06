import type { MultiProvider } from '@main/ai-providers/multi-provider'
import type { LoopMessage } from './loopContext'

// ============================================================
// 配置常量
// ============================================================

/** 各 provider 的默认上下文窗口大小 */
const CONTEXT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  deepseek: 128_000,
  openai: 128_000,
  google: 1_000_000,
}

const DEFAULT_CONTEXT_WINDOW = 128_000

export interface CompactionSettings {
  enabled: boolean
  /** 为模型响应保留的 token 空间 */
  reserveTokens: number
  /** 触发压缩的上下文使用率阈值（百分比 10-90） */
  thresholdPercent: number
  /** 保留的最近对话对数（1-10） */
  keepRecentPairs: number
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 4096,
  thresholdPercent: 70,
  keepRecentPairs: 3,
}

const logger = {
  info: (msg: string, ...args: unknown[]) => console.log(`[compaction] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[compaction] ${msg}`, ...args),
}

// ============================================================
// Token 估算
// ============================================================

/** 粗略 token 估算：chars/4 启发式 */
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
  return total + 4 // role overhead
}

function estimateContextTokens(messages: LoopMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
}

function getContextWindow(providerFormat: string): number {
  return CONTEXT_WINDOWS[providerFormat] ?? DEFAULT_CONTEXT_WINDOW
}

// ============================================================
// 切点选择
// ============================================================

/**
 * 找到安全切点：按对话对数从最新消息往前计数，
 * 保留最近 keepRecentPairs 对 user-assistant 对话。
 * 切点必须在 user 消息边界，绝不能切断 tool-result。
 */
function findCutPointByPairs(messages: LoopMessage[], keepRecentPairs: number): number {
  let userCount = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userCount++
      if (userCount >= keepRecentPairs) {
        // 找到第 keepRecentPairs 个 user 消息，这里就是切点
        // 确保切点之后的 tool-result 不会被切断
        return i
      }
    }
  }

  // 消息不足 keepRecentPairs 对，无需压缩
  return 0
}

// ============================================================
// 对话序列化
// ============================================================

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

// ============================================================
// LLM 摘要生成
// ============================================================

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

/**
 * Generate a continuation-focused summary with a bounded output budget.
 */
async function generateSummary(
  serialized: string,
  aiProvider: MultiProvider,
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

  try {
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
  catch (error) {
    // 摘要失败时回退到简单截断提示
    logger.warn('[compaction] summary generation failed, using truncation fallback', error)
    throw error
  }
}

export interface CompactionInput {
  messages: LoopMessage[]
  settings: CompactionSettings
  aiProvider: MultiProvider
  model: string
  providerFormat: string
  abortSignal?: AbortSignal
}

export interface CompactionResult {
  messages: LoopMessage[]
  compacted: boolean
  /** 摘要纯文本，用于持久化到 DB */
  summaryText?: string
  summaryLength?: number
  keptLength?: number
}

/**
 * 对消息列表执行上下文压缩。
 * 返回压缩后的新消息列表（包含摘要消息 + 保留的消息）。
 */
export async function compactMessages(input: CompactionInput): Promise<CompactionResult> {
  const { messages, settings, aiProvider, model, providerFormat, abortSignal } = input

  if (!settings.enabled) {
    return { messages, compacted: false }
  }

  const estimatedTokens = estimateContextTokens(messages)
  const contextWindow = getContextWindow(providerFormat)
  const thresholdTokens = Math.floor(contextWindow * settings.thresholdPercent / 100)

  logger.info(`context check: estimated=${estimatedTokens}, window=${contextWindow}, threshold=${settings.thresholdPercent}% (${thresholdTokens} tokens)`)

  if (estimatedTokens <= thresholdTokens) {
    return { messages, compacted: false }
  }

  // 找到安全切点（按对话对数保留）
  const cutIndex = findCutPointByPairs(messages, settings.keepRecentPairs)
  if (cutIndex <= 0) {
    logger.warn('no safe cut point found, skipping compaction')
    return { messages, compacted: false }
  }

  const toSummarize = messages.slice(0, cutIndex)
  const toKeep = messages.slice(cutIndex)

  logger.info(`compacting: total=${messages.length}, cutIndex=${cutIndex}, summarize=${toSummarize.length}, keep=${toKeep.length}`)

  // 序列化旧消息
  const serialized = serializeMessages(toSummarize)

  // 生成摘要
  let summary: string
  try {
    summary = await generateSummary(serialized, aiProvider, model, settings.reserveTokens, abortSignal)
  }
  catch {
    // 摘要生成失败，回退：保留原来的旧消息（不做压缩）
    logger.warn('summary failed, keeping original messages')
    return { messages, compacted: false }
  }

  // 构建压缩后的消息列表
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

  logger.info(`compaction complete: summary=${summary.length} chars, kept=${toKeep.length} msgs, total=${compactedMessages.length}`)

  return {
    messages: compactedMessages,
    compacted: true,
    summaryText: summary,
    summaryLength: summary.length,
    keptLength: toKeep.length,
  }
}

export { estimateContextTokens, getContextWindow }
