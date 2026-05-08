import { describe, expect, it } from 'vitest'
import { tokenizeMessageReferences } from '../messageReferenceTokens'

describe('tokenizeMessageReferences', () => {
  it('识别 @ 文件和 / skill token', () => {
    expect(tokenizeMessageReferences('分析 @src/a.ts /code-review')).toEqual([
      { type: 'text', text: '分析 ', offset: 0 },
      { type: 'file', text: '@src/a.ts', value: 'src/a.ts', offset: 3 },
      { type: 'text', text: ' ', offset: 12 },
      { type: 'skill', text: '/code-review', value: 'code-review', offset: 13 },
    ])
  })

  it('普通文本保持不变', () => {
    expect(tokenizeMessageReferences('hello')).toEqual([{ type: 'text', text: 'hello', offset: 0 }])
  })
})
