/* eslint-disable regexp/no-super-linear-backtracking -- 表格分隔行正则的分支可交换是结构性的，输入长度受单行限制 */

/**
 * 微信 iLink 发送前的文本规整与块级拆分。
 *
 * 微信不能编辑已发送消息，且聊天可读性要求"一条一条"组织内容。
 * 这里复刻 Hermes WeixinAdapter 的发送体验：空行规整、长行折行、
 * 按 Markdown 块打包拆分，代码块整体不拆，单块超限时补闭合/重开 fence。
 */

const FENCE_RE = /^```[^\n`]*$/
const TABLE_RULE_RE = /^[ \t]*\|?[ \t]*(?::?-{3,}:?[ \t]*\|)+[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$/
const HEADER_RE = /^#{1,6}[ \t]+\S.*$/

export const DEFAULT_WEIXIN_MAX_MESSAGE_LENGTH = 2000
export const WEIXIN_COPY_LINE_WIDTH = 120

/** 压缩连续空行：非代码块区域最多保留一个空行，代码块内容原样保留。 */
export function normalizeMarkdownBlocks(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let inCodeBlock = false
  let blankRun = 0

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    if (FENCE_RE.test(line.trim())) {
      inCodeBlock = !inCodeBlock
      result.push(line)
      blankRun = 0
      continue
    }
    if (inCodeBlock) {
      result.push(line)
      continue
    }
    if (!line.trim()) {
      blankRun += 1
      if (blankRun <= 1)
        result.push('')
      continue
    }
    blankRun = 0
    result.push(line)
  }

  return result.join('\n').trim()
}

/** 超过宽度的普通显示行折行；代码块、表格行、空行保持原样。 */
export function wrapCopyFriendlyLines(content: string, width: number = WEIXIN_COPY_LINE_WIDTH): string {
  if (!content)
    return content

  const wrapped: string[] = []
  let inCodeBlock = false

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    const stripped = line.trim()

    if (FENCE_RE.test(stripped)) {
      inCodeBlock = !inCodeBlock
      wrapped.push(line)
      continue
    }
    if (
      inCodeBlock
      || line.length <= width
      || !stripped
      || stripped.startsWith('|')
      || TABLE_RULE_RE.test(stripped)
    ) {
      wrapped.push(line)
      continue
    }

    wrapped.push(...wrapLongLine(line, width))
  }

  return wrapped.join('\n').trim()
}

/** 按空白折行：空白原样保留、单词不拆，长单词整词溢出到下一行。 */
function wrapLongLine(line: string, width: number): string[] {
  const parts = line.split(/(\s+)/)
  const out: string[] = []
  let current = ''

  for (const part of parts) {
    if (!part)
      continue
    if (/^\s+$/.test(part)) {
      if (current.length + part.length <= width)
        current += part
      continue
    }
    if (current && current.length + part.length > width) {
      out.push(current)
      current = part
    }
    else {
      current += part
    }
  }
  if (current)
    out.push(current)
  return out
}

/** 按空行切分为 Markdown 块；三反引号 fence 无论内部如何都算一个完整块。 */
export function splitMarkdownBlocks(content: string): string[] {
  if (!content)
    return []

  const blocks: string[] = []
  let current: string[] = []
  let inCodeBlock = false

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    if (FENCE_RE.test(line.trim())) {
      if (!inCodeBlock && current.length) {
        blocks.push(current.join('\n').trim())
        current = []
      }
      current.push(line)
      inCodeBlock = !inCodeBlock
      if (!inCodeBlock) {
        blocks.push(current.join('\n').trim())
        current = []
      }
      continue
    }
    if (inCodeBlock) {
      current.push(line)
      continue
    }
    if (!line.trim()) {
      if (current.length) {
        blocks.push(current.join('\n').trim())
        current = []
      }
      continue
    }
    current.push(line)
  }

  if (current.length)
    blocks.push(current.join('\n').trim())
  return blocks.filter(Boolean)
}

/** 顶层拆分单元：空行/换行拆开，缩进续行归并到上一行，代码块整体保留。 */
export function splitDeliveryUnits(content: string): string[] {
  const units: string[] = []

  for (const block of splitMarkdownBlocks(content)) {
    if (FENCE_RE.test(block.split('\n')[0]?.trim() ?? '')) {
      units.push(block)
      continue
    }

    let current: string[] = []
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\s+$/, '')
      if (!line.trim()) {
        if (current.length) {
          units.push(current.join('\n').trim())
          current = []
        }
        continue
      }
      const isContinuation = current.length > 0 && (rawLine.startsWith(' ') || rawLine.startsWith('\t'))
      if (isContinuation) {
        current.push(line)
        continue
      }
      if (current.length)
        units.push(current.join('\n').trim())
      current = [line]
    }
    if (current.length)
      units.push(current.join('\n').trim())
  }

  return units.filter(Boolean)
}

/** 单行是否像一句独立聊天话语（用于判断是否拆气泡）。 */
function looksLikeChattyLine(line: string): boolean {
  const stripped = line.trim()
  if (!stripped)
    return false
  if (stripped.length > 48)
    return false
  if (line.startsWith(' ') || line.startsWith('\t'))
    return false
  if (stripped.startsWith('>') || stripped.startsWith('-') || stripped.startsWith('*') || stripped.startsWith('【') || stripped.startsWith('#') || stripped.startsWith('|'))
    return false
  // 结构化命令回复的字段行（如 /new 的“工作区：/path”）保持整段，不拆成气泡。
  if (/^[^\s:：]{1,24}[：:]\s*\S/.test(stripped))
    return false
  if (TABLE_RULE_RE.test(stripped))
    return false
  if (/^\*\*[^*]+\*\*$/.test(stripped))
    return false
  if (/^\d+\.\s/.test(stripped))
    return false
  return true
}

/** 短行（≤24 字符且以冒号结尾）或 # 标题视为 heading。 */
function looksLikeHeadingLine(line: string): boolean {
  const stripped = line.trim()
  if (!stripped)
    return false
  if (HEADER_RE.test(stripped))
    return true
  return stripped.length <= 24 && (stripped.endsWith(':') || stripped.endsWith('：'))
}

/** 仅 2-6 行且每行都像聊天话语的短块拆成独立气泡，结构化内容保持整段。 */
function shouldSplitShortChatBlock(block: string): boolean {
  const lines = block.split('\n').filter(line => line.trim())
  if (lines.length < 2 || lines.length > 6)
    return false
  if (looksLikeHeadingLine(lines[0] ?? ''))
    return false
  return lines.every(line => looksLikeChattyLine(line))
}

/** 块级打包：尽量把相邻块合并进同一条消息，单块超限交给 truncateMessage。 */
export function packMarkdownBlocks(content: string, maxLength: number): string[] {
  if (content.length <= maxLength)
    return [content]

  const packed: string[] = []
  let current = ''
  for (const block of splitMarkdownBlocks(content)) {
    const candidate = current ? `${current}\n\n${block}` : block
    if (candidate.length <= maxLength) {
      current = candidate
      continue
    }
    if (current) {
      packed.push(current)
      current = ''
    }
    if (block.length <= maxLength) {
      current = block
      continue
    }
    packed.push(...truncateMessage(block, maxLength))
  }
  if (current)
    packed.push(current)
  return packed
}

/**
 * 按最大长度拆分文本：优先在换行/空格处切，切点落在代码块内时
 * 补闭合 fence 并在下一条重开（保留原语言标签），多块时追加 (i/n) 指示。
 */
export function truncateMessage(content: string, maxLength: number): string[] {
  if (content.length <= maxLength)
    return [content]

  const INDICATOR_RESERVE = 10
  const FENCE_CLOSE = '\n```'
  const chunks: string[] = []
  let remaining = content
  let carryLang: string | null = null

  while (remaining) {
    const prefix = carryLang !== null ? `\`\`\`${carryLang}\n` : ''
    let headroom = maxLength - INDICATOR_RESERVE - prefix.length - FENCE_CLOSE.length
    if (headroom < 1)
      headroom = Math.floor(maxLength / 2)

    if (prefix.length + remaining.length <= maxLength - INDICATOR_RESERVE) {
      chunks.push(prefix + remaining)
      break
    }

    const region = remaining.slice(0, headroom)
    let splitAt = region.lastIndexOf('\n')
    if (splitAt < headroom / 2)
      splitAt = region.lastIndexOf(' ')
    if (splitAt < 1)
      splitAt = headroom

    // 避免切在内联代码 span 内：反引号不成对时回溯到最后一个反引号前的空白。
    const candidate = remaining.slice(0, splitAt)
    const backtickCount = (candidate.match(/`/g) ?? []).length - (candidate.match(/\\`/g) ?? []).length
    if (backtickCount % 2 === 1) {
      const lastBt = candidate.lastIndexOf('`')
      const safeSplit = Math.max(candidate.lastIndexOf(' ', lastBt), candidate.lastIndexOf('\n', lastBt))
      if (safeSplit > headroom / 4)
        splitAt = safeSplit
    }

    const chunkBody = remaining.slice(0, splitAt)
    remaining = remaining.slice(splitAt).replace(/^\s+/, '')

    let inCode = carryLang !== null
    let lang: string = carryLang ?? ''
    for (const line of chunkBody.split('\n')) {
      const stripped = line.trim()
      if (stripped.startsWith('```')) {
        if (inCode) {
          inCode = false
          lang = ''
        }
        else {
          inCode = true
          const tag = stripped.slice(3).trim()
          lang = tag.split(/\s+/)[0] ?? ''
        }
      }
    }

    if (inCode) {
      chunks.push(prefix + chunkBody + FENCE_CLOSE)
      carryLang = lang
    }
    else {
      chunks.push(prefix + chunkBody)
      carryLang = null
    }
  }

  if (chunks.length > 1) {
    const total = chunks.length
    return chunks.map((chunk, index) => `${chunk} (${index + 1}/${total})`)
  }
  return chunks
}

/**
 * 微信发送前拆分：默认紧凑模式，整段能放下就一条（短对话块除外）；
 * 超出长度按 Markdown 块打包。splitPerLine 为 legacy 行为：顶层换行即独立消息。
 */
export function splitWeixinDelivery(content: string, maxLength: number = DEFAULT_WEIXIN_MAX_MESSAGE_LENGTH, splitPerLine: boolean = false): string[] {
  const normalized = normalizeMarkdownBlocks(content)
  if (!normalized)
    return []

  if (splitPerLine) {
    if (normalized.length <= maxLength && !normalized.includes('\n'))
      return [normalized]
    const chunks: string[] = []
    for (const unit of splitDeliveryUnits(normalized)) {
      if (unit.length <= maxLength) {
        chunks.push(unit)
        continue
      }
      chunks.push(...packMarkdownBlocks(unit, maxLength))
    }
    return chunks.length > 0 ? chunks : [normalized]
  }

  if (normalized.length <= maxLength) {
    const units = splitDeliveryUnits(normalized).filter(Boolean)
    return shouldSplitShortChatBlock(normalized) && units.length > 0 ? units : [normalized]
  }
  const packed = packMarkdownBlocks(normalized, maxLength)
  return packed.length > 0 ? packed : [normalized]
}
