import type { IMessage } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { transformMessageContent } from '../messageTransform'

function createMessage(content: IMessage['content']): IMessage {
  return {
    attachments: [],
    content,
    convId: 'conv-1',
    createdAt: 1,
    id: 'msg-1',
    images: [],
    role: 'user',
    status: 'success',
    updatedAt: 1,
  } as IMessage
}

describe('messageTransform', () => {
  it('数组文本内容不会在首段前增加换行', () => {
    expect(transformMessageContent(createMessage([
      { text: '@resume.md 现在看下效果', type: 'text' },
    ]))).toBe('@resume.md 现在看下效果')
  })

  it('多个内容块之间保留单个换行', () => {
    expect(transformMessageContent(createMessage([
      { text: '第一段', type: 'text' },
      { text: '第二段', type: 'text' },
    ]))).toBe('第一段\n第二段')
  })
})
