import { describe, expect, it } from 'vitest'
import { normalizeLegacyContentBlock, normalizeLegacyMessageContent } from '../contentNormalize'

describe('contentNormalize', () => {
  it('把旧格式 image-block 归一为 image，media_type 映射到 mimeType', () => {
    expect(normalizeLegacyContentBlock({
      type: 'image-block',
      source: { type: 'file_id', file_id: 'img-1' },
      name: 'a.png',
      media_type: 'image/png',
      size: 10,
    })).toEqual({
      type: 'image',
      source: { type: 'file_id', file_id: 'img-1' },
      name: 'a.png',
      mimeType: 'image/png',
      size: 10,
    })
  })

  it('image-block 无 media_type 时只改 type', () => {
    expect(normalizeLegacyContentBlock({
      type: 'image-block',
      source: { type: 'file_id', file_id: 'img-2' },
    })).toEqual({
      type: 'image',
      source: { type: 'file_id', file_id: 'img-2' },
    })
  })

  it('非 image-block 块原样返回', () => {
    const text = { type: 'text', text: 'hi' }
    const document = { type: 'document', source: { type: 'file_id', file_id: 'doc-1' }, media_type: 'text/plain' }
    expect(normalizeLegacyContentBlock(text)).toBe(text)
    expect(normalizeLegacyContentBlock(document)).toBe(document)
  })

  it('非对象元素原样返回', () => {
    expect(normalizeLegacyContentBlock(null)).toBeNull()
    expect(normalizeLegacyContentBlock(undefined)).toBeUndefined()
    expect(normalizeLegacyContentBlock('str')).toBe('str')
  })

  it('normalizeLegacyMessageContent 逐块归一数组，非数组原样返回', () => {
    const content = [
      { type: 'text', text: 'hi' },
      { type: 'image-block', source: { type: 'file_id', file_id: 'img-1' }, media_type: 'image/png' },
    ]
    expect(normalizeLegacyMessageContent(content)).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', source: { type: 'file_id', file_id: 'img-1' }, mimeType: 'image/png' },
    ])
    expect(normalizeLegacyMessageContent('not-array')).toBe('not-array')
  })
})
