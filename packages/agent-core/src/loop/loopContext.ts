import type { IMessage, LoopMessage } from '@ant-chat/shared'

export type NormalizeToolArgsResult
  = | { ok: true, input: Record<string, unknown> }
    | { ok: false, error: string }

export function createLoopSystemPrompt(workspacePath: string, customPrompt?: string): string {
  if (customPrompt) {
    return customPrompt.split('{workspacePath}').join(workspacePath)
  }
  return [
    'You are an AI assistant. Your goal is to complete the user\'s task, not to describe what you plan to do.',
    `Workspace path: ${workspacePath}`,
    'Rules:',
    '1. Always call tools for file-related requests. Do not guess file contents.',
    '2. Take the single most valuable next step each turn.',
    '3. Your output must be either a final answer or paired with an active tool call. Do not output plan-only statements.',
    '4. Work inside the workspace directory. Prefer relative paths.',
    '5. If a tool returns an error, adjust parameters and retry. Do not repeat the same failing call.',
    '6. If a tool result indicates more content is available, continue reading.',
    '7. When sufficient information is available, execute the change and provide the final result.',
  ].join('\n')
}

export function buildConversationContextMessages(
  messages: IMessage[],
  currentUserMessageId: string,
  lastCompactedAt?: number,
  lastCompactionSummary?: string,
): LoopMessage[] {
  const valid = messages
    .filter((message): message is IMessage & { role: 'user' | 'assistant' | 'tool' } => {
      if (message.id === currentUserMessageId)
        return false
      if (message.role === 'event')
        return false
      if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool')
        return false
      if (lastCompactedAt && message.createdAt < lastCompactedAt)
        return false
      if (message.role === 'user' || message.role === 'tool')
        return true
      return message.status === 'success' || message.status === 'error' || message.status === 'cancel'
    })

  const result: LoopMessage[] = []

  if (lastCompactionSummary && lastCompactedAt) {
    result.push({
      role: 'user',
      content: [{
        type: 'text',
        text: [
          'Previous conversation history has been compressed into the following summary:',
          '<summary>',
          lastCompactionSummary,
          '</summary>',
          'Continue the task based on the above summary and subsequent conversation.',
        ].join('\n'),
      }],
    })
  }

  for (const message of valid) {
    const content: LoopMessage['content'] = []
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

    if (content.length === 0)
      continue

    result.push({
      role: message.role as LoopMessage['role'],
      content,
    })
  }

  return result
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
