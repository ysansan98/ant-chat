export type MessageTokenPart
  = | { type: 'text', text: string, offset: number }
    | { type: 'file', text: string, value: string, offset: number }
    | { type: 'skill', text: string, value: string, offset: number }

const TOKEN_PATTERN = /(^|\s)(@\S+|\/[\w.-]+)/g

export function tokenizeMessageReferences(content: string): MessageTokenPart[] {
  const parts: MessageTokenPart[] = []
  let cursor = 0

  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const prefix = match[1]
    const token = match[2]
    const tokenStart = (match.index || 0) + prefix.length

    if (tokenStart > cursor) {
      parts.push({ type: 'text', text: content.slice(cursor, tokenStart), offset: cursor })
    }

    parts.push({
      type: token.startsWith('@') ? 'file' : 'skill',
      text: token,
      value: token.slice(1),
      offset: tokenStart,
    })
    cursor = tokenStart + token.length
  }

  if (cursor < content.length) {
    parts.push({ type: 'text', text: content.slice(cursor), offset: cursor })
  }

  return parts.length > 0 ? parts : [{ type: 'text', text: content, offset: 0 }]
}
