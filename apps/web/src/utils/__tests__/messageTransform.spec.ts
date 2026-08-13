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

  it('可视化内容转换为只读摘要，不暴露 artifact bytes', () => {
    expect(transformMessageContent(createMessage([{
      type: 'visualization',
      source: { type: 'file_id', file_id: 'viz-1' },
      format: 'ant-chat.visualization.html.v1',
      title: '阶段延迟',
      summary: '比较阶段延迟',
      size: 32,
      sha256: '0'.repeat(64),
      data: '不应进入文本',
    }]))).toBe('[可视化：阶段延迟]')
  })

  it('image 内联数据已是完整 data URL 时原样输出，不重复拼接前缀', () => {
    expect(transformMessageContent(createMessage([
      { type: 'text', text: '看图' },
      { type: 'image', data: 'data:image/png;base64,AAAA', mimeType: 'image/png' },
    ]))).toBe('看图\n![](data:image/png;base64,AAAA)')
  })

  it('image 内联数据为纯 base64 时补齐 mimeType 前缀', () => {
    expect(transformMessageContent(createMessage([
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ]))).toBe('![](data:image/png;base64,AAAA)')
  })

  it('image 为引用形态（无 data）时显示占位文本', () => {
    expect(transformMessageContent(createMessage([
      { type: 'image', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png' },
    ]))).toBe('[Image: a.png]')
  })

  it('skipAttachmentBlocks 时跳过有渲染通道的附件块，只保留文本', () => {
    expect(transformMessageContent(createMessage([
      { type: 'text', text: '看一下这两个文件' },
      { type: 'image', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png' },
      { type: 'document', source: { type: 'file_id', file_id: 'doc-1' }, name: 'a.pdf' },
      { type: 'file', source: { type: 'file_id', file_id: 'f-1' }, filename: 'b.zip' },
    ]), { skipAttachmentBlocks: true })).toBe('看一下这两个文件')
  })

  it('skipAttachmentBlocks 不影响无附件块的消息', () => {
    expect(transformMessageContent(createMessage([
      { type: 'text', text: '第一段' },
      { type: 'text', text: '第二段' },
    ]), { skipAttachmentBlocks: true })).toBe('第一段\n第二段')
  })

  it('annotation 块渲染为引用与评论', () => {
    expect(transformMessageContent(createMessage([
      { type: 'annotation', quote: '原回复内容', comment: '这里要改', targetMessageId: 'msg-1' },
      { type: 'text', text: '另外的问题' },
    ]))).toBe('引用：原回复内容\n评论：这里要改\n另外的问题')
  })

  it('annotation 块无评论（只引用）时只渲染引用', () => {
    expect(transformMessageContent(createMessage([
      { type: 'annotation', quote: '原回复内容', comment: '', targetMessageId: 'msg-1' },
    ]))).toBe('引用：原回复内容')
  })
})
