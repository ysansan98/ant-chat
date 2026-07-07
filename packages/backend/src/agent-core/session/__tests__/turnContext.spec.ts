import { describe, expect, it } from 'vitest'
import { buildPromptWithTurnContext } from '../turnContext'

describe('buildPromptWithTurnContext 行为', () => {
  it('不带上下文时返回原始 prompt', () => {
    expect(buildPromptWithTurnContext({ prompt: '分析项目' })).toBe('分析项目')
  })

  it('注入 @ 文件引用并要求通过 read_file 读取', () => {
    const result = buildPromptWithTurnContext({
      prompt: '分析这些文件',
      referencedFiles: ['src/a.ts', '../bad.ts', '/tmp/outside.ts', 'src/a.ts'],
    })

    expect(result).toContain('- src/a.ts')
    expect(result).toContain('必须使用 read_file')
    expect(result).not.toContain('../bad.ts')
    expect(result).not.toContain('/tmp/outside.ts')
  })
})
