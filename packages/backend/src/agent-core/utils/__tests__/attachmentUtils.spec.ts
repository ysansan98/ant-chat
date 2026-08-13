import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { contentBlocksToLoopMessageContent } from '../attachmentUtils'

describe('contentBlocksToLoopMessageContent 行为', () => {
  it('将 annotation 块渲染为引用原文 + 评论的结构化文本', async () => {
    const content = await contentBlocksToLoopMessageContent([
      { type: 'annotation', quote: '原回复内容', comment: '这里要改', targetMessageId: 'msg-1' },
    ])
    expect(content).toEqual([
      {
        type: 'text',
        text: '<annotation>\n<quote>\n原回复内容\n</quote>\n<comment>\n这里要改\n</comment>\n</annotation>',
      },
    ])
  })

  it('annotation 块无评论时只渲染引用原文', async () => {
    const content = await contentBlocksToLoopMessageContent([
      { type: 'annotation', quote: '原回复内容', comment: '', targetMessageId: 'msg-1' },
    ])
    expect(content).toEqual([
      {
        type: 'text',
        text: '<annotation>\n<quote>\n原回复内容\n</quote>\n</annotation>',
      },
    ])
  })

  it('将图片文件引用加载为 base64 image content', async () => {
    const loadFileData = vi.fn(async () => 'image-base64')

    const content = await contentBlocksToLoopMessageContent([
      {
        type: 'image',
        source: { type: 'file_id', file_id: 'img-1' },
        name: 'image.png',
        mimeType: 'image/png',
      },
    ], loadFileData)

    expect(loadFileData).toHaveBeenCalledWith('img-1')
    expect(content).toEqual([
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'image-base64',
      },
    ])
  })

  it('开启 imageToPlaceholder 时把图片引用替换为 file_id 占位符文本，不再读取图片数据', async () => {
    const loadFileData = vi.fn(async () => 'image-base64')
    const onReplaced = vi.fn()

    const content = await contentBlocksToLoopMessageContent([
      {
        type: 'image',
        source: { type: 'file_id', file_id: 'img-1' },
        name: 'photo.png',
        mimeType: 'image/png',
      },
    ], loadFileData, {
      imageToPlaceholder: {
        onReplaced,
      },
    })

    expect(loadFileData).not.toHaveBeenCalled()
    expect(content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('file_id=img-1'),
      },
    ])
    expect(content[0].type === 'text' && content[0].text).toContain('photo.png')
    expect(onReplaced).toHaveBeenCalledWith([{
      fileId: 'img-1',
      name: 'photo.png',
      mimeType: 'image/png',
    }])
  })

  it('imageToPlaceholder 把多张图片合并为一个汇总占位符列表', async () => {
    const loadFileData = vi.fn(async () => 'image-base64')
    const onReplaced = vi.fn()

    const content = await contentBlocksToLoopMessageContent([
      {
        type: 'image',
        source: { type: 'file_id', file_id: 'img-1' },
        name: 'a.png',
        mimeType: 'image/png',
      },
      {
        type: 'image',
        source: { type: 'file_id', file_id: 'img-2' },
        name: 'b.jpg',
        mimeType: 'image/jpeg',
      },
      {
        type: 'text',
        text: '看看这些图',
      },
    ], loadFileData, {
      imageToPlaceholder: {
        onReplaced,
      },
    })

    expect(content).toHaveLength(2)
    const placeholder = content[0]
    expect(placeholder.type).toBe('text')
    if (placeholder.type === 'text') {
      expect(placeholder.text).toContain('用户上传了 2 张图片')
      expect(placeholder.text).toContain('1) a.png file_id=img-1')
      expect(placeholder.text).toContain('2) b.jpg file_id=img-2')
      expect(placeholder.text).toContain('ant-chat image recognize --file-id img-1 --json')
    }
    expect(content[1]).toEqual({ type: 'text', text: '看看这些图' })
    expect(loadFileData).not.toHaveBeenCalled()
    expect(onReplaced).toHaveBeenCalledWith([
      { fileId: 'img-1', name: 'a.png', mimeType: 'image/png' },
      { fileId: 'img-2', name: 'b.jpg', mimeType: 'image/jpeg' },
    ])
  })

  it('发送给模型前将文件引用加载为 base64 file content', async () => {
    const loadFileData = vi.fn(async () => Buffer.from('hello\n', 'utf8').toString('base64'))

    const content = await contentBlocksToLoopMessageContent([
      {
        type: 'document',
        source: { type: 'file_id', file_id: 'doc-1' },
        name: 'note.txt',
        media_type: 'text/plain',
      },
    ], loadFileData)

    expect(content).toEqual([
      {
        type: 'file',
        mimeType: 'text/plain',
        data: Buffer.from('hello\n', 'utf8').toString('base64'),
      },
    ])
  })

  it('保留已有 inline image content 且不要求 url', async () => {
    const content = await contentBlocksToLoopMessageContent([
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'image-base64',
      },
    ])

    expect(content).toEqual([
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'image-base64',
      },
    ])
  })
})
