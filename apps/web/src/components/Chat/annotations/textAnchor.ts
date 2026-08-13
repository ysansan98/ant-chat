/**
 * 批注文本锚定：在渲染后的 markdown DOM 上建立「纯文本 → text node」映射，
 * 用纯文本偏移定位选中内容。不依赖 DOM 结构，因此跨代码块/表格/内联样式均可覆盖。
 *
 * 块级边界（p/li/td/pre 等）之间补一个换行，使映射文本与浏览器选区文本
 * （Range.toString()）大体一致；quote 一律取自映射文本切片，保证创建与复现使用同一套文本。
 */

export interface TextNodeEntry {
  node: Text
  /** 映射文本中的起始偏移（含块级边界补的换行） */
  start: number
  end: number
}

export interface TextNodeMap {
  text: string
  entries: TextNodeEntry[]
}

/** 浏览器选区 toString 会在这些块级容器之间插入换行，映射文本按同一规则补齐。 */
const BLOCK_LEVEL_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'UL',
  'OL',
  'TD',
  'TH',
  'TR',
  'TABLE',
  'PRE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'FIGURE',
  'FIGCAPTION',
  'DL',
  'DT',
  'DD',
])

function hasBlockBreak(node: Text, prev: Text): boolean {
  const parent = node.parentElement
  const prevParent = prev.parentElement
  if (!parent || !prevParent) {
    return false
  }
  if (parent !== prevParent) {
    // 跨父元素：新父元素是块级容器时补换行；同块级容器内的内联兄弟（strong/em/span）不补
    return BLOCK_LEVEL_TAGS.has(parent.tagName)
  }
  // 同一父元素：中间存在 <br> 时补换行
  let cursor: Node | null = prev.nextSibling
  while (cursor && cursor !== node) {
    if (cursor instanceof HTMLElement && cursor.tagName === 'BR') {
      return true
    }
    cursor = cursor.nextSibling
  }
  return false
}

/** 遍历根节点下所有文本节点，建立纯文本 → text node 映射。 */
export function buildTextNodeMap(root: Node): TextNodeMap {
  const entries: TextNodeEntry[] = []
  let text = ''
  let prev: Text | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current: Node | null = walker.nextNode()
  while (current) {
    const node = current as Text
    const prefix = prev && hasBlockBreak(node, prev) ? '\n' : ''
    text += prefix + node.data
    entries.push({ node, start: text.length - node.data.length, end: text.length })
    prev = node
    current = walker.nextNode()
  }
  return { text, entries }
}

function entryAt(map: TextNodeMap, offset: number): TextNodeEntry | null {
  for (const entry of map.entries) {
    if (offset >= entry.start && offset <= entry.end) {
      return entry
    }
  }
  return null
}

/**
 * 在偏移处切分文本节点（splitText），使后续区间定位落在节点边界上。
 * 原地修改 DOM，返回重建后的映射；偏移位于边界时不做任何事。
 */
export function splitTextNode(root: Node, map: TextNodeMap, offset: number): TextNodeMap {
  const entry = entryAt(map, offset)
  if (!entry) {
    return map
  }
  if (offset <= entry.start || offset >= entry.end) {
    return map
  }
  entry.node.splitText(offset - entry.start)
  return buildTextNodeMap(root)
}

/**
 * 把 [start, end) 区间内的文本包进一个高亮 <mark>。
 * 返回是否成功应用；区间为空或定位失败时返回 false（调用方走引用卡片兜底）。
 */
export function applyHighlight(root: Node, map: TextNodeMap, start: number, end: number): boolean {
  if (end <= start || start < 0 || end > map.text.length) {
    return false
  }
  const mapAfterStart = splitTextNode(root, map, start)
  const finalMap = splitTextNode(root, mapAfterStart, end)
  const nodes: Text[] = []
  for (const entry of finalMap.entries) {
    if (entry.start >= start && entry.end <= end) {
      nodes.push(entry.node)
    }
  }
  if (nodes.length === 0) {
    return false
  }
  // 按父元素分组：跨块选区（多个段落/列表项）的文本必须留在各自的父元素内，
  // 否则把不同父元素的文本节点并入同一个 mark 会抽空原容器、破坏文档结构
  const groups = new Map<Node, Text[]>()
  for (const node of nodes) {
    const parent = node.parentNode
    if (!parent) {
      continue
    }
    const group = groups.get(parent) ?? []
    group.push(node)
    groups.set(parent, group)
  }
  for (const group of groups.values()) {
    const mark = document.createElement('mark')
    mark.dataset.annotationHighlight = 'true'
    mark.className = 'rounded-sm bg-amber-500/10'
    const first = group[0]
    const parent = first.parentNode
    if (!parent) {
      continue
    }
    // 先把空 mark 插入原位，再移入该组节点，避免引用失效
    parent.insertBefore(mark, first)
    for (const node of group) {
      mark.appendChild(node)
    }
  }
  return true
}

/** 移除根节点下所有批注高亮 <mark>，恢复原始文本节点。 */
export function clearHighlights(root: ParentNode): void {
  root.querySelectorAll('mark[data-annotation-highlight]').forEach((el) => {
    el.replaceWith(...Array.from(el.childNodes))
  })
}

/** 把映射偏移还原为 DOM Range（用于选区定位、首行坐标计算）。 */
export function resolveRange(map: TextNodeMap, start: number, end: number): Range | null {
  const startEntry = entryAt(map, start)
  const endEntry = entryAt(map, end)
  if (!startEntry || !endEntry) {
    return null
  }
  const range = document.createRange()
  range.setStart(startEntry.node, Math.min(start - startEntry.start, startEntry.node.data.length))
  range.setEnd(endEntry.node, Math.min(end - endEntry.start, endEntry.node.data.length))
  return range
}

/** 在映射文本中查找引用文本的精确偏移（渲染变化时的兜底匹配）。 */
export function findQuoteOffset(map: TextNodeMap, quote: string): { start: number, end: number } | null {
  const index = map.text.indexOf(quote)
  if (index < 0) {
    return null
  }
  return { start: index, end: index + quote.length }
}
