import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { contentBlocksToLoopMessageContent } from '../attachmentUtils'

describe('contentBlocksToLoopMessageContent', () => {
  it('loads image file references as base64 image content', async () => {
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

  it('decodes text file references before sending them to the model', async () => {
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
        type: 'text',
        text: '<document name="note.txt" type="text/plain">\nhello\n\n</document>',
      },
    ])
  })

  it('keeps existing inline image content without requiring a url', async () => {
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
