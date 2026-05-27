import type { IMessage, LoopMessage } from '@ant-chat/shared'

const HISTORY_TOOL_CALLS_KEEP = 4

export type NormalizeToolArgsResult
  = | { ok: true, input: Record<string, unknown> }
    | { ok: false, error: string }

// 构建 agent 循环的系统提示词。消费者可通过 config.systemPrompt 自定义，
// 使用 {workspacePath} 占位符注入工作区路径。
export function createLoopSystemPrompt(workspacePath: string, customPrompt?: string): string {
  if (customPrompt) {
    return customPrompt.split('{workspacePath}').join(workspacePath)
  }
  // 默认英文轻量提示
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
    .filter((message): message is IMessage & { role: 'user' | 'assistant' } => {
      if (message.id === currentUserMessageId)
        return false
      if (message.role !== 'user' && message.role !== 'assistant')
        return false
      if (lastCompactedAt && message.createdAt < lastCompactedAt)
        return false
      if (message.role === 'user')
        return true
      return message.status === 'success' || message.status === 'error' || message.status === 'cancel'
    })

  const result: LoopMessage[] = []

  if (lastCompactionSummary && lastCompactedAt) {
    result.push({
      role: 'user',
      content: [{
        type: 'text',
        // 将压缩摘要注入上下文，模型基于摘要继续任务
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
    const text = extractMessageText(message)

    if (message.role === 'user') {
      result.push({ role: 'user', content: [{ type: 'text', text }] })
      continue
    }

    const content: LoopMessage['content'] = []
    if (text) {
      content.push({ type: 'text', text })
    }

    const completedTools = (message.toolCalls || [])
      .filter(tool => tool.executeState === 'completed')
      .slice(-HISTORY_TOOL_CALLS_KEEP)

    for (const tool of completedTools) {
      content.push({
        type: 'tool-call',
        toolCallId: tool.id,
        toolName: tool.toolName,
        args: tool.args,
      })
    }

    result.push({ role: 'assistant', content })

    for (const tool of completedTools) {
      if (!tool.result) {
        continue
      }
      const toolData = tool.result.success
        ? (tool.result.data || '')
        : (tool.result.error || '')
      result.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: tool.id,
          toolName: tool.toolName,
          result: toolData,
          isError: !tool.result.success,
        }],
      })
    }
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

function extractMessageText(message: IMessage): string {
  return (message.content || [])
    .map((item) => {
      if (item.type === 'text')
        return item.text
      if (item.type === 'error')
        return `[error] ${item.error}`
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}
