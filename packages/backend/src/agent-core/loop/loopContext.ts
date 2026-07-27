import type { IMessage, LanguageModelUsage, LoadFileDataFn, LoopMessage } from '@ant-chat/shared'
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

export function createLoopSystemPrompt(workspacePath: string, conversationInstructions?: string, memorySnapshot?: LoopSystemPromptMemory): string {
  const baseSections = [
    'You are an AI assistant. Your goal is to complete the user\'s task, not to describe what you plan to do.',
    `Workspace path: ${workspacePath}`,
    'Rules:',
    '1. Always call tools for file-related requests. Do not guess file contents.',
    '2. Use persistent memory when it is available and the user provides a durable preference, correction, environment fact, or stable convention.',
    '3. Take the single most valuable next step each turn.',
    '4. Your output must be either a final answer or paired with an active tool call. Do not output plan-only statements.',
    '5. Commands already run in the workspace directory. Do not change to it first — just write the command directly.',
    '6. If a tool returns an error, adjust parameters and retry. Do not repeat the same failing call.',
    '7. If a tool result indicates more content is available, continue reading.',
    '8. When sufficient information is available, execute the change and provide the final result.',
  ].join('\n')

  const sections = [baseSections]

  // <workspace_references> — 解释 @path 语法，始终存在
  sections.push([
    '<workspace_references>',
    '用户消息中的 `@<path>` 表示当前工作区根目录下的相对路径。例如 `@src/app.ts` 表示工作区中的 `src/app.ts`。',
    '该标记只提供路径定位，不表示文件内容已经提供。需要文件内容时，必须使用文件工具读取，不得臆测。',
    '绝对路径或包含 `..` 的路径不得按工作区引用处理；实际路径访问仍必须受工作区边界校验。',
    '</workspace_references>',
  ].join('\n'))

  sections.push([
    '<skill_reference>',
    '用户可以使用 /skill-name 的语法引用 Skill。当一个以 / 开头的标记匹配可用的 Skill 名称时，应将其解释为 Skill 调用，而不是文件系统路径或普通文本，并在继续处理任务之前加载该 Skill。',
    '</skill_reference>',
  ].join('\n'))

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

  // <conversation_instructions> — 仅非空时追加
  const instructions = conversationInstructions?.trim()
  if (instructions) {
    sections.push([
      '<conversation_instructions>',
      instructions.split('{workspacePath}').join(workspacePath),
      '</conversation_instructions>',
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
  usage?: LanguageModelUsage
  status?: IMessage['status']
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
      status: message.status,
      usage: message.role === 'assistant' ? message.usage : undefined,
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
