import type { MessageBlockView, MessageView } from './evidenceModel'

/** JSON 身份兜底：循环引用等异常值不阻断渲染。 */
function stringifyIdentity(value: unknown): string {
  if (value === undefined)
    return ''
  try {
    return JSON.stringify(value) ?? String(value)
  }
  catch {
    return String(value)
  }
}

/** 按数据身份生成稳定 key；完全相同的内容用出现序号区分。 */
export function withStableKeys<T>(items: T[], identity: (item: T) => string): Array<{ item: T, key: string }> {
  const occurrences = new Map<string, number>()
  return items.map((item) => {
    const base = identity(item)
    const occurrence = occurrences.get(base) ?? 0
    occurrences.set(base, occurrence + 1)
    return { item, key: occurrence === 0 ? base : `${base}#${occurrence}` }
  })
}

/** 模型工具调用不一定有 id，用工具名、参数和错误信息构成身份。 */
export function modelToolCallIdentity(call: { id?: string, toolName: string, input?: unknown, invalidArgsError?: string }): string {
  if (call.id)
    return `id:${call.id}`
  return `${call.toolName}:${call.invalidArgsError ?? ''}:${stringifyIdentity(call.input)}`
}

export function blockIdentity(block: MessageBlockView): string {
  const callId = block.toolCallId ? `:${block.toolCallId}` : ''
  switch (block.type) {
    case 'text':
      return `text${callId}:${block.text ?? ''}`
    case 'image':
    case 'file':
      return `${block.type}${callId}:${block.mimeType ?? ''}`
    case 'tool-call':
      return `tool-call${callId}:${block.toolName ?? ''}:${stringifyIdentity(block.args)}`
    case 'tool-result':
      return `tool-result${callId}:${block.toolName ?? ''}:${block.isError ? 'error' : 'ok'}:${stringifyIdentity(block.result)}`
    default:
      return `unknown${callId}:${stringifyIdentity(block.raw)}`
  }
}

export function messageIdentity(message: MessageView): string {
  return `${message.role}:${message.blocks.map(blockIdentity).join('|')}`
}
