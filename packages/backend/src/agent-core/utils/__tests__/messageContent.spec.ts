import { describe, expect, it } from 'vitest'
import { extractMessageText } from '../messageContent'

describe('extractMessageText', () => {
  it('纯批注消息（无 text 块）用评论作为文本', () => {
    expect(extractMessageText([
      { type: 'annotation', quote: '引用原文', comment: '这段要改', targetMessageId: 'msg-1' },
    ])).toBe('这段要改')
  })

  it('批注无评论（只引用）时用引用原文兜底', () => {
    expect(extractMessageText([
      { type: 'annotation', quote: '引用原文', comment: '', targetMessageId: 'msg-1' },
    ])).toBe('引用原文')
  })

  it('批注与普通文本混合时按序拼接', () => {
    expect(extractMessageText([
      { type: 'annotation', quote: '引用原文', comment: '这段要改', targetMessageId: 'msg-1' },
      { type: 'text', text: '另外的问题' },
    ])).toBe('这段要改\n另外的问题')
  })
})
