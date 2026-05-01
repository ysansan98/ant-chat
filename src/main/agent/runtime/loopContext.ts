import type { IMessage } from '@ant-chat/shared'

const LOOP_MESSAGE_WINDOW = 20
const HISTORY_MESSAGE_LIMIT = 16

export interface LoopMessage {
  role: 'user' | 'assistant'
  content: Array<{ type: 'text', text: string }>
}

export interface RuntimeState {
  goal: string
  readFiles: Map<string, string[]>
  writtenFiles: Set<string>
  loadedSkills: Map<string, string>
  lastAction: 'read' | 'write' | 'other'
}

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

export function createRuntimeState(goal: string): RuntimeState {
  return {
    goal,
    readFiles: new Map(),
    writtenFiles: new Set(),
    loadedSkills: new Map(),
    lastAction: 'other',
  }
}

export function buildPlanningPrompt(
  goal: string,
  state: RuntimeState,
  observations: string[],
): string {
  const lastReads = [...state.readFiles.entries()]
    .slice(-3)
    .map(([path, ranges]) => `${path}: ${ranges.slice(-2).join(', ')}`)
    .join('; ')
  const written = [...state.writtenFiles].slice(-5).join(', ') || '(none)'
  const recentObs = observations.slice(-2).join('\n')
  const loadedSkills = formatLoadedSkills(state)
  return [
    `继续任务：${goal}`,
    `状态摘要：lastAction=${state.lastAction}; writtenFiles=${written}; recentReads=${lastReads || '(none)'}`,
    loadedSkills,
    '执行要求：若已完成修改，直接输出最终结果，不要再次全量读取同一文件。',
    recentObs ? `最近观察：\n${recentObs}` : '',
  ].filter(Boolean).join('\n')
}

export function buildConversationContextMessages(
  messages: IMessage[],
  currentUserMessageId: string,
): LoopMessage[] {
  const valid = messages
    .filter(message => message.id !== currentUserMessageId)
    .filter((message): message is IMessage & { role: 'user' | 'assistant' } => message.role === 'user' || message.role === 'assistant')
    .filter((message) => {
      if (message.role === 'user') {
        return true
      }
      return message.status === 'success' || message.status === 'error' || message.status === 'cancel'
    })
    .slice(-HISTORY_MESSAGE_LIMIT)

  return valid.map((message) => {
    const text = stringifyMessageForContext(message)
    return {
      role: message.role,
      content: [{ type: 'text', text }],
    }
  })
}

export function trimLoopMessages(messages: LoopMessage[]) {
  if (messages.length <= LOOP_MESSAGE_WINDOW) {
    return
  }
  const [first, ...rest] = messages
  const tail = rest.slice(-(LOOP_MESSAGE_WINDOW - 1))
  messages.splice(0, messages.length, first, ...tail)
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

export function normalizeToolArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    }
    catch {}
  }
  return {}
}

export function updateRuntimeStateOnToolSuccess(
  state: RuntimeState,
  toolName: string,
  input: Record<string, unknown>,
  result?: { output?: unknown },
) {
  const loadedSkill = parseLoadedSkillOutput(result?.output)
  if (loadedSkill) {
    state.loadedSkills.set(loadedSkill.name, loadedSkill.content)
    state.lastAction = 'other'
    return
  }

  if (toolName === 'read_file') {
    const path = typeof input.path === 'string' ? input.path : '(unknown)'
    const offset = Number(input.offset || 1)
    const limit = Number(input.limit || 200)
    const range = `${offset}-${offset + Math.max(limit - 1, 0)}`
    const ranges = state.readFiles.get(path) || []
    ranges.push(range)
    state.readFiles.set(path, ranges.slice(-6))
    state.lastAction = 'read'
    return
  }
  if (toolName === 'write_file') {
    if (typeof input.path === 'string')
      state.writtenFiles.add(input.path)
    state.lastAction = 'write'
    return
  }
  if (toolName === 'apply_patch') {
    const path = extractPatchPrimaryPath(String(input.patch || ''))
    if (path)
      state.writtenFiles.add(path)
    state.lastAction = 'write'
    return
  }
  state.lastAction = 'other'
}

function parseLoadedSkillOutput(output: unknown): { name: string, content: string } | null {
  if (!output || typeof output !== 'object') {
    return null
  }
  const data = output as Record<string, unknown>
  if (data.type !== 'skill_loaded' || typeof data.name !== 'string' || typeof data.content !== 'string') {
    return null
  }
  return { name: data.name, content: data.content }
}

function formatLoadedSkills(state: RuntimeState): string {
  const entries = [...state.loadedSkills.entries()]
  if (entries.length === 0) {
    return ''
  }
  const maxTotalChars = 24_000
  let remaining = maxTotalChars
  const sections: string[] = []
  for (const [name, content] of entries) {
    if (remaining <= 0) {
      break
    }
    const body = content.length <= remaining ? content : `${content.slice(0, remaining)}\n[skill context truncated]`
    sections.push(`Loaded skill: ${name}\nInstructions:\n${body}`)
    remaining -= body.length
  }
  return `已载入 Skill 上下文：\n${sections.join('\n\n')}`
}

export function updateRuntimeStateOnToolFailure(
  state: RuntimeState,
  toolName: string,
): void {
  if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'apply_patch') {
    state.lastAction = 'other'
  }
}

function stringifyMessageForContext(message: IMessage): string {
  const baseText = (message.content || [])
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

  if (message.role !== 'assistant' || !Array.isArray(message.toolCalls) || message.toolCalls.length === 0) {
    return baseText
  }

  const toolSummaries = message.toolCalls
    .filter(tool => tool.executeState === 'completed')
    .slice(-4)
    .map((tool) => {
      const result = tool.result
      if (!result) {
        return `tool ${tool.toolName}: completed`
      }
      if (result.success) {
        const dataPreview = truncateText(result.data || '', 200)
        return dataPreview
          ? `tool ${tool.toolName}: success ${dataPreview}`
          : `tool ${tool.toolName}: success`
      }
      return `tool ${tool.toolName}: failed ${result.error || ''}`.trim()
    })
    .join('\n')

  if (!toolSummaries) {
    return baseText
  }

  if (!baseText) {
    return `历史工具结果:\n${toolSummaries}`
  }
  return `${baseText}\n\n历史工具结果:\n${toolSummaries}`
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit)}...(truncated)`
}

function extractPatchPrimaryPath(patch: string): string | null {
  const lines = patch.split('\n')
  for (const line of lines) {
    if (line.startsWith('*** Update File: ')) {
      return line.replace('*** Update File: ', '').trim()
    }
    if (line.startsWith('*** Add File: ')) {
      return line.replace('*** Add File: ', '').trim()
    }
  }
  return null
}
