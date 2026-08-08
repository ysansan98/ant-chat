import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { uploadMediaToIlink } from '../mediaUpload'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  uploadCiphertext: vi.fn(async () => 'encrypted-param-1'),
}))

vi.mock('../ilinkHttp', () => ({
  aes128EcbEncrypt: (plaintext: Buffer) => Buffer.concat([plaintext, Buffer.from('PAD')]),
  aesPaddedSize: (size: number) => Math.ceil(size / 16) * 16,
  DEFAULT_CDN_BASE_URL: 'https://cdn.test',
  weixinPost: mocks.post,
  weixinUploadCiphertext: mocks.uploadCiphertext,
}))

beforeEach(() => {
  mocks.post.mockReset()
  mocks.uploadCiphertext.mockReset()
  mocks.uploadCiphertext.mockImplementation(async () => 'encrypted-param-1')
})

const imageAttachment = {
  name: 'photo.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  data: Buffer.from('fake-image-bytes').toString('base64'),
  size: 16,
}

describe('微信媒体上传内部接缝', () => {
  it('图片附件经 getuploadurl 与 CDN 上传后组装 image_item', async () => {
    mocks.post.mockResolvedValueOnce({ upload_full_url: 'https://cdn.test/direct-upload' })

    const result = await uploadMediaToIlink({
      post: mocks.post,
      baseUrl: 'https://ilink.example',
      botToken: 'token-1',
      chatId: 'chat-1',
      attachment: imageAttachment,
    })

    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({
      path: 'ilink/bot/getuploadurl',
      token: 'token-1',
      body: expect.objectContaining({ media_type: 1, to_user_id: 'chat-1', rawfilemd5: expect.any(String) }),
    }))
    expect(mocks.uploadCiphertext).toHaveBeenCalledWith(expect.objectContaining({ uploadUrl: 'https://cdn.test/direct-upload' }))
    expect(result.mediaItem.type).toBe(2)
    expect(result.mediaItem.image_item).toEqual(expect.objectContaining({
      mid_size: expect.any(Number),
      media: expect.objectContaining({ encrypt_query_param: 'encrypted-param-1', encrypt_type: 1 }),
    }))
    expect(result.plaintextLength).toBe(Buffer.byteLength('fake-image-bytes'))
  })

  it('文档附件按文件媒体类型组装 file_item 并保留文件名', async () => {
    mocks.post.mockResolvedValueOnce({ upload_param: 'param-1' })

    const result = await uploadMediaToIlink({
      post: mocks.post,
      baseUrl: 'https://ilink.example',
      botToken: 'token-1',
      chatId: 'chat-1',
      attachment: { ...imageAttachment, name: '报告.md', kind: 'document', mediaType: 'text/markdown' },
    })

    expect(result.mediaItem.type).toBe(4)
    expect(result.mediaItem.file_item).toEqual(expect.objectContaining({
      file_name: '报告.md',
      len: String(Buffer.byteLength('fake-image-bytes')),
      media: expect.objectContaining({ encrypt_query_param: 'encrypted-param-1' }),
    }))
    expect(mocks.post.mock.calls[0]?.[0].body.media_type).toBe(3)
  })

  it('getuploadurl 未返回上传地址时直接抛错', async () => {
    mocks.post.mockResolvedValueOnce({})

    await expect(uploadMediaToIlink({
      post: mocks.post,
      baseUrl: 'https://ilink.example',
      botToken: 'token-1',
      chatId: 'chat-1',
      attachment: imageAttachment,
    })).rejects.toThrow('微信 getuploadurl 未返回 upload_full_url 或 upload_param')
  })
})
