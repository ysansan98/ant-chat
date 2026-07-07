import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { contentBlocksToLoopMessageContent } from '../attachmentUtils'

describe('contentBlocksToLoopMessageContent 行为', () => {
  it('将图片文件引用加载为 base64 image content', async () => {
    const loadFileData = vi.fn(async () => 'image-base64')

    const content = await contentBlocksToLoopMessageContent([
      {
        type: 'image-block',
        source: { type: 'file_id', file_id: 'img-1' },
        name: 'image.png',
        media_type: 'image/png',
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
