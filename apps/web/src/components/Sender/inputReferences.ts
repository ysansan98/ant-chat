export interface ActiveReferenceTrigger {
  type: 'file' | 'skill'
  query: string
  start: number
  end: number
}

export interface ParsedCommand {
  id: string
  argument?: string
}

interface ReferenceTokenRange {
  type: 'file' | 'skill'
  start: number
  end: number
  trailingSpaceEnd: number
  text: string
}

export type ReferenceInputPart
  = | { type: 'text', text: string, offset: number }
    | { type: 'file' | 'skill', text: string, offset: number }

export function getActiveReferenceTrigger(text: string, cursor: number): ActiveReferenceTrigger | null {
  const beforeCursor = text.slice(0, cursor)
  const match = /(^|\s)([@/])(\S*)$/.exec(beforeCursor)
  if (!match || match.index === undefined) {
    return null
  }

  const prefixLength = match[1].length
  const start = match.index + prefixLength

  return {
    type: match[2] === '@' ? 'file' : 'skill',
    query: match[3],
    start,
    end: cursor,
  }
}

export function insertReferenceToken(
  text: string,
  trigger: ActiveReferenceTrigger,
  token: string,
): { text: string, cursor: number } {
  const before = text.slice(0, trigger.start)
  const after = text.slice(trigger.end)
  const needsSpace = after.length === 0 || !/^\s/.test(after)
  const nextText = `${before}${token}${needsSpace ? ' ' : ''}${after}`

  return {
    text: nextText,
    cursor: before.length + token.length + (needsSpace ? 1 : 0),
  }
}

/**
 * 把当前 @ 触发区段改写为 `@<nextQuery>`（不带尾空格），光标落在末尾。
 *
 * 用于目录补全与返回上级：不产生已确认 token、不进入已确认文件引用、
 * 不关闭面板，由新的 trigger.query 触发下一轮搜索。
 *
 * 与 {@link insertReferenceToken} 的区别：后者补尾空格、用于确认最终 token。
 */
export function rewriteReferenceTrigger(
  text: string,
  trigger: ActiveReferenceTrigger,
  nextQuery: string,
): { text: string, cursor: number } {
  const before = text.slice(0, trigger.start)
  const after = text.slice(trigger.end)
  const token = `@${nextQuery}`
  const nextText = `${before}${token}${after}`
  return { text: nextText, cursor: before.length + token.length }
}

/**
 * 计算返回上级后的 query。仅当 query 含 `/`（已钻取）时有效。
 *
 * - `src/components/` -> `src/`
 * - `src/components`  -> `src/`
 * - `src/`            -> `''`（回到根）
 * - `src`             -> `null`（未钻取，不可返回）
 */
export function parentReferenceQuery(query: string): string | null {
  if (!query.includes('/')) {
    return null
  }
  const trimmed = query.endsWith('/') ? query.slice(0, -1) : query
  const idx = trimmed.lastIndexOf('/')
  return idx < 0 ? '' : trimmed.slice(0, idx + 1)
}

export function syncConfirmedFileReferences(text: string, selected: string[]): string[] {
  const ranges = getReferenceTokenRanges(text, selected)
  return selected.filter(file =>
    ranges.some(range => range.type === 'file' && range.text === `@${file}`),
  )
}

export function syncConfirmedSkillReference(text: string, selected?: string): string | undefined {
  if (!selected) {
    return undefined
  }

  const ranges = getReferenceTokenRanges(text, [], selected)
  return ranges.some(range => range.type === 'skill' && range.text === `/${selected}`)
    ? selected
    : undefined
}

export function isCompletedReferenceTrigger(
  trigger: ActiveReferenceTrigger | null,
  confirmedFileReferences: string[],
  confirmedSkillReference?: string,
): boolean {
  if (!trigger) {
    return false
  }

  if (trigger.type === 'file') {
    return confirmedFileReferences.includes(trigger.query)
  }

  return confirmedSkillReference === trigger.query
}

export function removeReferenceTokenAtCursor(
  text: string,
  cursor: number,
  key: 'Backspace' | 'Delete',
  confirmedFileReferences: string[],
  confirmedSkillReference?: string,
): { text: string, cursor: number } | null {
  const ranges = getReferenceTokenRanges(text, confirmedFileReferences, confirmedSkillReference)

  for (const range of ranges) {
    const shouldRemove = key === 'Backspace'
      ? cursor > range.start && cursor <= range.trailingSpaceEnd
      : cursor >= range.start && cursor < range.end

    if (!shouldRemove) {
      continue
    }

    return {
      text: `${text.slice(0, range.start)}${text.slice(range.trailingSpaceEnd)}`,
      cursor: range.start,
    }
  }

  return null
}

export function moveCursorAcrossReferenceToken(
  text: string,
  cursor: number,
  key: 'ArrowLeft' | 'ArrowRight',
  confirmedFileReferences: string[],
  confirmedSkillReference?: string,
): number | null {
  const ranges = getReferenceTokenRanges(text, confirmedFileReferences, confirmedSkillReference)

  for (const range of ranges) {
    if (key === 'ArrowLeft' && cursor > range.start && cursor <= range.end) {
      return range.start
    }
    if (key === 'ArrowRight' && cursor >= range.start && cursor < range.end) {
      return range.trailingSpaceEnd
    }
  }

  return null
}

export function snapCursorToReferenceTokenBoundary(
  text: string,
  cursor: number,
  confirmedFileReferences: string[],
  confirmedSkillReference?: string,
): number {
  const ranges = getReferenceTokenRanges(text, confirmedFileReferences, confirmedSkillReference)

  for (const range of ranges) {
    if (cursor > range.start && cursor < range.end) {
      const distanceToStart = cursor - range.start
      const distanceToEnd = range.end - cursor
      return distanceToStart < distanceToEnd ? range.start : range.trailingSpaceEnd
    }
  }

  return cursor
}

export function buildReferenceInputParts(
  text: string,
  confirmedFileReferences: string[],
  confirmedSkillReference?: string,
): ReferenceInputPart[] {
  const parts: ReferenceInputPart[] = []
  const ranges = getReferenceTokenRanges(text, confirmedFileReferences, confirmedSkillReference)
  let cursor = 0

  for (const range of ranges) {
    if (range.start < cursor) {
      continue
    }

    if (range.start > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, range.start), offset: cursor })
    }

    parts.push({ type: range.type, text: range.text, offset: range.start })
    cursor = range.end
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor), offset: cursor })
  }

  return parts.length > 0 ? parts : [{ type: 'text', text, offset: 0 }]
}

function getReferenceTokenRanges(
  text: string,
  confirmedFileReferences: string[],
  confirmedSkillReference?: string,
): ReferenceTokenRange[] {
  const tokens = [
    ...confirmedFileReferences.map(file => `@${file}`),
    ...(confirmedSkillReference ? [`/${confirmedSkillReference}`] : []),
  ]
  const ranges: ReferenceTokenRange[] = []

  for (const token of tokens) {
    let start = text.indexOf(token)
    while (start !== -1) {
      const end = start + token.length
      const hasStartBoundary = start === 0 || /\s/.test(text[start - 1])
      const hasEndBoundary = end === text.length || /\s/.test(text[end])

      if (hasStartBoundary && hasEndBoundary) {
        ranges.push({
          type: token.startsWith('@') ? 'file' : 'skill',
          start,
          end,
          trailingSpaceEnd: text[end] === ' ' ? end + 1 : end,
          text: token,
        })
      }

      start = text.indexOf(token, end)
    }
  }

  return ranges.sort((a, b) => a.start - b.start)
}
