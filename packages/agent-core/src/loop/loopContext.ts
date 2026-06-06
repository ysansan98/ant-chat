import type { IMessage, LoadFileDataFn, LoopMessage } from '@ant-chat/shared'
import { contentBlocksToLoopMessageContent } from '../utils/attachmentUtils'

export interface LoopSystemPromptMemory {
  memory?: string
  soul?: string
  user?: string
}

export type NormalizeToolArgsResult
  = | { ok: true, input: Record<string, unknown> }
    | { ok: false, error: string }

const MEMORY_GUIDANCE = [
  'You have persistent memory across sessions. Save durable facts using the memory tool: user preferences, environment details, tool quirks, and stable conventions.',
  'The memory snapshot in the system prompt is frozen for the current conversation. Memory tool results return the latest entries after each edit.',
  'Prioritize facts that reduce future user steering. User preferences and recurring corrections matter more than procedural task details.',
  'Do not save task progress, session outcomes, completed-work logs, temporary TODO state, PR numbers, issue numbers, commit SHAs, fixed bugs, phase status, file counts, or facts likely to be stale within 7 days.',
  'Write memories as declarative facts, not instructions. Use "User prefers concise responses" instead of "Always respond concisely". Use "Project uses pytest with xdist" instead of "Run tests with pytest -n 4".',
  'Procedures and workflows belong in skills, not memory.',
].join('\n')

export function createLoopSystemPrompt(workspacePath: string, customPrompt?: string, memorySnapshot?: LoopSystemPromptMemory): string {
  const basePrompt = customPrompt
    ? customPrompt.split('{workspacePath}').join(workspacePath)
    : [
        'You are an AI assistant. Your goal is to complete the user\'s task, not to describe what you plan to do.',
        `Workspace path: ${workspacePath}`,
        'Rules:',
        '1. Always call tools for file-related requests. Do not guess file contents.',
        '2. Use persistent memory when it is available and the user provides a durable preference, correction, environment fact, or stable convention.',
        '3. Take the single most valuable next step each turn.',
        '4. Your output must be either a final answer or paired with an active tool call. Do not output plan-only statements.',
        '5. Work inside the workspace directory. Prefer relative paths.',
        '6. If a tool returns an error, adjust parameters and retry. Do not repeat the same failing call.',
        '7. If a tool result indicates more content is available, continue reading.',
        '8. When sufficient information is available, execute the change and provide the final result.',
      ].join('\n')

  const sections = [basePrompt]
  const memory = memorySnapshot?.memory?.trim()
  const soul = memorySnapshot?.soul?.trim()
  const user = memorySnapshot?.user?.trim()

  if (memorySnapshot) {
    sections.push([
      '<memory_guidance>',
      MEMORY_GUIDANCE,
      '</memory_guidance>',
    ].join('\n'))
  }

  if (soul) {
    sections.push([
      '<agent_behavior>',
      'The following SOUL.md defines stable agent behavior. Follow it unless the current user instruction explicitly overrides it.',
      soul,
      '</agent_behavior>',
    ].join('\n'))
  }

  if (user) {
    sections.push([
      '<user_preferences>',
      'The following USER.md snapshot contains one durable user preference per line. This snapshot is frozen for the current conversation; memory tool results return the latest entries after edits.',
      user,
      '</user_preferences>',
    ].join('\n'))
  }

  if (memory) {
    sections.push([
      '<agent_memory>',
      'The following MEMORY.md snapshot contains one durable agent note per line. This snapshot is frozen for the current conversation; memory tool results return the latest entries after edits.',
      memory,
      '</agent_memory>',
    ].join('\n'))
  }

  return sections.join('\n\n')
}

export async function buildConversationContextMessages(
  messages: IMessage[],
  currentUserMessageId?: string,
  loadFileData?: LoadFileDataFn,
): Promise<LoopMessage[]> {
  const entries = await buildConversationContextEntries(messages, currentUserMessageId, loadFileData)
  return entries.map(entry => entry.message)
}

export interface ConversationContextEntry {
  message: LoopMessage
  sourceMessageId: string
}

export async function buildConversationContextEntries(
  messages: IMessage[],
  currentUserMessageId?: string,
  loadFileData?: LoadFileDataFn,
): Promise<ConversationContextEntry[]> {
  const latestCompactionEventIndex = findLatestCompactionEventIndex(messages)
  const latestCompactionEvent = latestCompactionEventIndex >= 0
    ? messages[latestCompactionEventIndex]
    : undefined
  const compactedThroughMessageIndex = latestCompactionEvent?.compactedThroughMessageId
    ? messages.findIndex(message => message.id === latestCompactionEvent.compactedThroughMessageId)
    : -1
  if (latestCompactionEvent?.compactedThroughMessageId && compactedThroughMessageIndex < 0) {
    throw new Error(`Compaction boundary message not found: ${latestCompactionEvent.compactedThroughMessageId}`)
  }
  const valid = messages
    .filter((message, index): message is IMessage & { role: 'user' | 'assistant' | 'tool' } => {
      if (currentUserMessageId && message.id === currentUserMessageId)
        return false
      if (message.role === 'event')
        return false
      if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool')
        return false
      if (compactedThroughMessageIndex >= 0 && index <= compactedThroughMessageIndex)
        return false
      if (message.role === 'user' || message.role === 'tool')
        return true
      return message.status === 'success' || message.status === 'cancel'
    })

  const result: ConversationContextEntry[] = []

  if (latestCompactionEvent) {
    const summary = getCompactionSummaryText(latestCompactionEvent)
    result.push({
      sourceMessageId: latestCompactionEvent.compactedThroughMessageId!,
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: [
            'Previous conversation history has been compressed into the following summary:',
            '<summary>',
            summary,
            '</summary>',
            'Continue the task based on the above summary and subsequent conversation.',
          ].join('\n'),
        }],
      },
    })
  }

  for (const message of valid) {
    const content: LoopMessage['content'] = []
    if (message.role === 'user') {
      content.push(...await contentBlocksToLoopMessageContent(message.content, loadFileData))
    }
    else {
      for (const block of message.content) {
        if (block.type === 'text') {
          content.push(block)
        }
        else if (block.type === 'tool-call' && message.role === 'assistant') {
          content.push({
            type: 'tool-call',
            toolCallId: block.toolCallId,
            toolName: block.toolName,
            args: block.args,
          })
        }
        else if (block.type === 'tool-result' && message.role === 'tool') {
          content.push({
            type: 'tool-result',
            toolCallId: block.toolCallId,
            toolName: block.toolName,
            result: block.result,
            isError: block.isError,
          })
        }
      }
    }

    if (content.length === 0)
      continue

    result.push({
      sourceMessageId: message.id,
      message: {
        role: message.role as LoopMessage['role'],
        content,
      },
    })
  }

  return result
}

function findLatestCompactionEventIndex(messages: IMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (
      message.role === 'event'
      && message.eventType === 'compaction'
      && message.status === 'success'
      && message.compactedThroughMessageId
    ) {
      return index
    }
  }
  return -1
}

function getCompactionSummaryText(message: IMessage): string {
  const summary = message.content
    .filter((block): block is { type: 'text', text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()

  if (!summary) {
    throw new Error(`Compaction event missing summary text: ${message.id}`)
  }
  return summary
}

export function normalizeToolArgs(args: unknown): NormalizeToolArgsResult {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return { ok: true, input: args as Record<string, unknown> }
  }
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, input: parsed as Record<string, unknown> }
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `args must be a JSON object: ${message}` }
    }
  }
  return { ok: false, error: 'args must be an object or a JSON object string' }
}
