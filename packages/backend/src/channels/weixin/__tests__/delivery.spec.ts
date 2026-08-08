import { describe, expect, it } from 'vitest'

import {
  normalizeMarkdownBlocks,
  splitDeliveryUnits,
  splitWeixinDelivery,
  truncateMessage,
  wrapCopyFriendlyLines,
} from '../delivery'

describe('normalizeMarkdownBlocks', () => {
  it('压缩连续空行，最多保留一个', () => {
    expect(normalizeMarkdownBlocks('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('代码块内的空行与内容原样保留', () => {
    const content = '```ts\n\nconst a = 1\n\n\n```\n\n\n结尾'
    expect(normalizeMarkdownBlocks(content)).toBe('```ts\n\nconst a = 1\n\n\n```\n\n结尾')
  })
})

describe('wrapCopyFriendlyLines', () => {
  it('超过 120 字符的普通行折行', () => {
    const long = `${'词'.repeat(30)} `.repeat(5)
    const lines = wrapCopyFriendlyLines(long).split('\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every(line => line.length <= 120)).toBe(true)
  })

  it('代码块与表格行不折行', () => {
    const content = `\`\`\`\n${'x'.repeat(200)}\n\`\`\`\n| ${'y'.repeat(200)} |`
    const lines = wrapCopyFriendlyLines(content).split('\n')
    expect(lines.some(line => line.startsWith('```'))).toBe(true)
    expect(lines.some(line => line.includes('y'.repeat(200)))).toBe(true)
  })
})

describe('splitWeixinDelivery', () => {
  it('空内容返回空数组', () => {
    expect(splitWeixinDelivery('')).toEqual([])
  })

  it('短文本整段一条', () => {
    expect(splitWeixinDelivery('你好，这是回复')).toEqual(['你好，这是回复'])
  })

  it('短对话块拆成独立气泡', () => {
    expect(splitWeixinDelivery('好的\n我马上处理')).toEqual(['好的', '我马上处理'])
  })

  it('标题开头或列表的结构化内容保持整段', () => {
    const content = '## 总结\n\n- 第一点\n- 第二点'
    expect(splitWeixinDelivery(content)).toEqual([content])
  })

  it('/new 等命令回复的字段行保持整段，不拆成多条', () => {
    const content = '已创建新会话\n工作区：/workspace\n当前模型：p1/m1\n权限模式：自动审查'
    expect(splitWeixinDelivery(content)).toEqual([content])
  })

  it('超出长度按 Markdown 块打包拆分，代码块整体不拆', () => {
    const content = '第一段\n\n```\ncode\n```\n\n第二段'
    const chunks = splitWeixinDelivery(content, 17)
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toContain('```\ncode\n```')
    expect(chunks[1]).toBe('第二段')
  })

  it('splitPerLine 模式按顶层单元拆分', () => {
    const chunks = splitWeixinDelivery('第一行\n第二行', 100, true)
    expect(chunks).toEqual(['第一行', '第二行'])
  })

  it('compact 模式下单块超限时追加分块指示', () => {
    const chunks = splitWeixinDelivery('内容'.repeat(30), 20)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => /\s\(\d+\/\d+\)$/.test(chunk))).toBe(true)
  })
})

describe('truncateMessage', () => {
  it('跨代码块截断时补闭合 fence 并在下一条重开', () => {
    const code = '```python\ndef hello():\n    print("hello")\n    print("world")\n```'
    const chunks = truncateMessage(code, 30)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.replace(/\s\(\d+\/\d+\)$/, '').endsWith('\n```')).toBe(true)
    expect(chunks[1]?.startsWith('```python')).toBe(true)
  })

  it('切点落在内联代码内时回溯到反引号前', () => {
    const content = `短前缀 \`code-span\` ${'尾部内容'.repeat(20)}`
    const chunks = truncateMessage(content, 60)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toContain('code-span')
  })
})

describe('splitDeliveryUnits', () => {
  it('缩进续行归并到上一行，避免拆散嵌套列表', () => {
    const content = '- 顶层项\n  - 子项\n\n独立段'
    expect(splitDeliveryUnits(content)).toEqual(['- 顶层项\n  - 子项', '独立段'])
  })
})
