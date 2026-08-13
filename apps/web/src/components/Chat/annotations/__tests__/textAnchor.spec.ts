import { describe, expect, it } from 'vitest'
import {
  applyHighlight,
  buildTextNodeMap,
  clearHighlights,
  resolveRange,
  splitTextNode,
} from '../textAnchor'

function renderText(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = html
  return div
}

describe('buildTextNodeMap', () => {
  it('纯文本节点建立单一映射条目', () => {
    const root = renderText('hello world')
    const map = buildTextNodeMap(root)
    expect(map.text).toBe('hello world')
    expect(map.entries).toHaveLength(1)
    expect(map.entries[0]).toMatchObject({ start: 0, end: 11 })
  })

  it('块级段落之间补换行（与浏览器选区文本一致）', () => {
    const root = renderText('<p>aaa</p><p>bbb</p>')
    const map = buildTextNodeMap(root)
    expect(map.text).toBe('aaa\nbbb')
    expect(map.entries).toHaveLength(2)
    expect(map.entries[1]).toMatchObject({ start: 4, end: 7 })
  })

  it('同一块级容器内的内联兄弟不补换行（代码高亮结构）', () => {
    const root = renderText('<pre><code><span>a</span><span>b</span></code></pre>')
    const map = buildTextNodeMap(root)
    expect(map.text).toBe('ab')
  })

  it('同一父元素内的 <br> 补换行', () => {
    const root = renderText('<div>a<br>b</div>')
    const map = buildTextNodeMap(root)
    expect(map.text).toBe('a\nb')
  })

  it('表格单元格之间补换行', () => {
    const root = renderText('<table><tr><td>a</td><td>b</td></tr></table>')
    const map = buildTextNodeMap(root)
    expect(map.text).toBe('a\nb')
  })
})

describe('splitTextNode', () => {
  it('在偏移处切分文本节点并重建映射', () => {
    const root = renderText('<p>hello world</p>')
    const map = buildTextNodeMap(root)
    const next = splitTextNode(root, map, 5)
    expect(next.entries).toHaveLength(2)
    expect(next.entries[0].node.data).toBe('hello')
    expect(next.entries[1].node.data).toBe(' world')
    expect(next.text).toBe('hello world')
  })

  it('偏移在节点边界时不切分', () => {
    const root = renderText('<p>hello</p>')
    const map = buildTextNodeMap(root)
    const next = splitTextNode(root, map, 0)
    expect(next.entries).toHaveLength(1)
    const end = splitTextNode(root, next, 5)
    expect(end.entries).toHaveLength(1)
  })
})

describe('applyHighlight / clearHighlights', () => {
  it('单节点区间包进 <mark>，文本内容不变', () => {
    const root = renderText('<p>hello world</p>')
    const map = buildTextNodeMap(root)
    expect(applyHighlight(root, map, 0, 5)).toBe(true)
    const mark = root.querySelector('mark[data-annotation-highlight]')
    expect(mark?.textContent).toBe('hello')
    expect(root.textContent).toBe('hello world')
  })

  it('跨块级节点的高亮按父元素分组，各自包 mark 且不破坏文档结构', () => {
    const root = renderText('<p>aaa</p><p>bbb</p>')
    const map = buildTextNodeMap(root)
    // 映射文本 aaa\nbbb，区间 [2, 6) = 'a\nbb'
    expect(applyHighlight(root, map, 2, 6)).toBe(true)
    const marks = root.querySelectorAll('mark[data-annotation-highlight]')
    expect(marks).toHaveLength(2)
    expect(marks[0]?.textContent).toBe('a')
    expect(marks[1]?.textContent).toBe('bb')
    // 两个段落结构保持：p1 剩余 'aa'，p2 剩余 'b'，文本未被抽空
    expect(root.textContent).toBe('aaabbb')
    const paragraphs = root.querySelectorAll('p')
    expect(paragraphs[0]?.textContent).toContain('aa')
    expect(paragraphs[1]?.textContent).toContain('b')
  })

  it('区间为空或定位失败时返回 false', () => {
    const root = renderText('<p>hello</p>')
    const map = buildTextNodeMap(root)
    expect(applyHighlight(root, map, 3, 3)).toBe(false)
    expect(applyHighlight(root, map, 0, 99)).toBe(false)
  })

  it('clearHighlights 移除高亮并恢复文本', () => {
    const root = renderText('<p>hello world</p>')
    const map = buildTextNodeMap(root)
    applyHighlight(root, map, 0, 5)
    clearHighlights(root)
    expect(root.querySelector('mark')).toBeNull()
    expect(root.textContent).toBe('hello world')
  })

  it('连续应用不同区间互不干扰（先清理再应用）', () => {
    const root = renderText('<p>hello world</p>')
    let map = buildTextNodeMap(root)
    applyHighlight(root, map, 0, 5)
    clearHighlights(root)
    map = buildTextNodeMap(root)
    expect(applyHighlight(root, map, 6, 11)).toBe(true)
    const mark = root.querySelector('mark[data-annotation-highlight]')
    expect(mark?.textContent).toBe('world')
  })
})

describe('resolveRange', () => {
  it('把映射偏移还原为 DOM Range 边界', () => {
    const root = renderText('<p>hello world</p>')
    const map = buildTextNodeMap(root)
    const range = resolveRange(map, 0, 5)
    expect(range?.startContainer).toBe(map.entries[0].node)
    expect(range?.startOffset).toBe(0)
    expect(range?.endContainer).toBe(map.entries[0].node)
    expect(range?.endOffset).toBe(5)
    expect(range?.toString()).toBe('hello')
  })

  it('跨段落 Range 覆盖两个文本节点', () => {
    const root = renderText('<p>aaa</p><p>bbb</p>')
    const map = buildTextNodeMap(root)
    const range = resolveRange(map, 2, 6)
    // jsdom 的 Range.toString() 不插入块级换行；映射文本中的换行是虚拟的
    expect(range?.toString()).toBe('abb')
  })

  it('偏移越界时返回 null', () => {
    const root = renderText('<p>hello</p>')
    const map = buildTextNodeMap(root)
    expect(resolveRange(map, 0, 99)).toBeNull()
  })
})
