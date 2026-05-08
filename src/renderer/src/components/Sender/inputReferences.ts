export interface ActiveReferenceTrigger {
  type: 'file' | 'skill'
  query: string
  start: number
  end: number
}

interface ReferenceTokenRange {
  start: number
  end: number
  trailingSpaceEnd: number
}

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

export function syncReferencedFiles(text: string, selected: string[]): string[] {
  return selected.filter(file => text.includes(`@${file}`))
}

export function syncSelectedSkill(text: string, selected?: string): string | undefined {
  if (!selected) {
    return undefined
  }
  return text.includes(`/${selected}`) ? selected : undefined
}

export function isCompletedReferenceTrigger(
  trigger: ActiveReferenceTrigger | null,
  referencedFiles: string[],
  selectedSkill?: string,
): boolean {
  if (!trigger) {
    return false
  }

  if (trigger.type === 'file') {
    return referencedFiles.includes(trigger.query)
  }

  return selectedSkill === trigger.query
}

export function removeReferenceTokenAtCursor(
  text: string,
  cursor: number,
  key: 'Backspace' | 'Delete',
  referencedFiles: string[],
  selectedSkill?: string,
): { text: string, cursor: number } | null {
  const ranges = getReferenceTokenRanges(text, referencedFiles, selectedSkill)

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
  referencedFiles: string[],
  selectedSkill?: string,
): number | null {
  const ranges = getReferenceTokenRanges(text, referencedFiles, selectedSkill)

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
  referencedFiles: string[],
  selectedSkill?: string,
): number {
  const ranges = getReferenceTokenRanges(text, referencedFiles, selectedSkill)

  for (const range of ranges) {
    if (cursor > range.start && cursor < range.end) {
      const distanceToStart = cursor - range.start
      const distanceToEnd = range.end - cursor
      return distanceToStart < distanceToEnd ? range.start : range.trailingSpaceEnd
    }
  }

  return cursor
}

function getReferenceTokenRanges(
  text: string,
  referencedFiles: string[],
  selectedSkill?: string,
): ReferenceTokenRange[] {
  const tokens = [
    ...referencedFiles.map(file => `@${file}`),
    ...(selectedSkill ? [`/${selectedSkill}`] : []),
  ]
  const ranges: ReferenceTokenRange[] = []

  for (const token of tokens) {
    let start = text.indexOf(token)
    while (start !== -1) {
      const end = start + token.length
      ranges.push({
        start,
        end,
        trailingSpaceEnd: text[end] === ' ' ? end + 1 : end,
      })
      start = text.indexOf(token, end)
    }
  }

  return ranges.sort((a, b) => a.start - b.start)
}
