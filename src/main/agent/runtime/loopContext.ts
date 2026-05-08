import type { IMessage } from '@ant-chat/shared'

const HISTORY_TOOL_RESULT_TRUNCATE = 100000

export interface LoopMessage {
  role: 'user' | 'assistant' | 'tool'
  content: Array<{ type: 'text', text: string } | { type: 'tool-call', toolCallId: string, toolName: string, args: Record<string, unknown> } | { type: 'tool-result', toolCallId: string, toolName: string, result: unknown, isError?: boolean }>
}

export type NormalizeToolArgsResult
  = | { ok: true, input: Record<string, unknown> }
    | { ok: false, error: string }

export function createLoopSystemPrompt(workspacePath: string): string {
  return [
    '你是一个AI助手代理，目标是完成用户任务，不是展示过程。',
    `当前工作区路径：${workspacePath}`,
    '执行准则：',
    '1. 与文件相关的请求必须优先调用工具，不要臆测文件内容。',
    '2. 每一轮只做一个最有价值的下一步，避免无意义重复读取。',
    '3. 你输出的自然语言要么是最终答复，要么配合当前已发起的工具调用；不要只输出“让我继续看看”这类计划句。',
    '目录与路径规则：',
    '1. 默认在当前工作区内工作，优先相对路径。',
    '2. 当用户未明确要求跨目录时，不要访问 "/" 或无关绝对路径。',
    '3. 如果工具返回路径不可访问或不存在，先改参数重试，不要重复同样调用。',
    '工具调用规则：',
    '1. read_file: offset 是 1-based 行号，limit 是行数。大文件必须递增 offset 分段读取。',
    '2. list_dir: 使用 offset/limit 分页。hasMore=true 继续下一页；hasMore=false 立即停止该目录读取。',
    '3. installed skills 会以工具形式出现。当任务匹配某个 skill 时，先调用 use_skill 或对应 skill_* 工具载入说明，再按说明继续调用 native tools。',
    '4. 遇到工具错误时，先根据错误文本调整参数，再决定是否重试。同一失败参数禁止连续重复。',
    '5. 工具结果可能被截断。若结果末尾包含继续读取提示，按提示继续读取，而不是改用无关工具。',
    '完成与停止：',
    '1. 只要信息已足够，就直接执行修改并给出最终结果。',
    '2. 完成后直接给最终答复，包含改了什么、在哪些文件、结果如何。',
    '3. 除非用户明确要求审计，不要为了“确认”而完整遍历所有文件。',
  ].join('\n')
}

export function buildConversationContextMessages(
  messages: IMessage[],
  currentUserMessageId: string,
  lastCompactedAt?: number,
  lastCompactionSummary?: string,
): LoopMessage[] {
  const valid = messages
    .filter(message => message.id !== currentUserMessageId)
    .filter((message): message is IMessage & { role: 'user' | 'assistant' } => message.role === 'user' || message.role === 'assistant')
    .filter((message) => {
      // 跳过已被压缩摘要替代的历史消息（使用 < 保证摘要消息自身不被过滤）
      if (lastCompactedAt && message.createdAt < lastCompactedAt) {
        return false
      }
      // 跳过压缩标记消息（UI 分隔线用），摘要内容已通过 lastCompactionSummary 注入
      if (isCompactionMarkerMessage(message)) {
        return false
      }
      if (message.role === 'user') {
        return true
      }
      return message.status === 'success' || message.status === 'error' || message.status === 'cancel'
    })

  const result: LoopMessage[] = []

  // 注入持久化的压缩摘要（不在聊天界面中显示，仅用于上下文构建）
  if (lastCompactionSummary && lastCompactedAt) {
    result.push({
      role: 'user',
      content: [{
        type: 'text',
        text: [
          '之前的对话历史已压缩为以下摘要：',
          '<summary>',
          lastCompactionSummary,
          '</summary>',
          '请基于以上摘要和后续对话继续完成任务。',
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

    // Assistant message: build content with text + tool-call blocks
    const content: LoopMessage['content'] = []
    if (text) {
      content.push({ type: 'text', text })
    }

    const completedTools = (message.toolCalls || [])
      .filter(tool => tool.executeState === 'completed')
      .slice(-4)

    for (const tool of completedTools) {
      content.push({
        type: 'tool-call',
        toolCallId: tool.id,
        toolName: tool.toolName,
        args: tool.args,
      })
    }

    result.push({ role: 'assistant', content })

    // Push tool result messages for completed tool calls
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
          result: truncateText(toolData, HISTORY_TOOL_RESULT_TRUNCATE),
          isError: !tool.result.success,
        }],
      })
    }
  }

  return result
}

export function looksLikePlanOnlyResponse(text: string): boolean {
  const content = text.trim()
  if (!content) {
    return false
  }
  const patterns = [
    '让我继续',
    '我来继续',
    '我先继续',
    '让我先',
    '继续读取',
    '继续查看',
    '再看看',
    '先看看',
  ]
  if (!patterns.some(pattern => content.includes(pattern))) {
    return false
  }
  const finalAnswerHints = [
    '已完成',
    '完成了',
    '修改如下',
    '我已经',
    '最终',
    '结论',
  ]
  return !finalAnswerHints.some(hint => content.includes(hint))
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

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit)}...(truncated)`
}

/** 检测是否为压缩标记消息（UI 分隔线，不应进入模型上下文） */
function isCompactionMarkerMessage(message: IMessage): boolean {
  if (message.role !== 'user')
    return false
  return message.content.some(block => block.type === 'text' && block.text.startsWith('__COMPACTION__'))
}
