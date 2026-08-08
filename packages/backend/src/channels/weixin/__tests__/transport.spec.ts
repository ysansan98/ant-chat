import { afterEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { createCipheriv, createHash } from 'node:crypto'

import { createWeixinTransport } from '../transport'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  randomBytes: vi.fn((size: number) => Buffer.alloc(size, 0x5A)),
}))

vi.mock('undici', () => ({ fetch: mocks.fetch }))
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    randomBytes: mocks.randomBytes,
  }
})

const CREDENTIAL = JSON.stringify({ botToken: 'token-1', baseUrl: 'https://ilink.example' })

function jsonResponse(body: unknown, status = 200): { ok: boolean, status: number, text: () => Promise<string> } {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

function textMessage(userId: string, text: string): Record<string, unknown> {
  return {
    msg_id: `msg-${userId}-${Math.random().toString(36).slice(2, 8)}`,
    from_user_id: userId,
    context_token: `ctx-${userId}`,
    item_list: [{ type: 1, text_item: { text } }],
  }
}

function nonTextMessage(userId: string): Record<string, unknown> {
  return {
    msg_id: `media-${userId}`,
    from_user_id: userId,
    context_token: `ctx-${userId}`,
    item_list: [{ type: 2 }],
  }
}

/**
 * 安装 fetch mock：非 getupdates 请求直接走 responders；getupdates 第一轮
 * 走 responders（注入消息），后续轮询挂起直到 stop() abort，模拟长轮询阻塞。
 */
function installFetchMock(responders: (url: string, init?: { signal?: AbortSignal, body?: string | Buffer }) => unknown): void {
  let polled = 0
  mocks.fetch.mockImplementation((input: unknown, init?: { signal?: AbortSignal, body?: string | Buffer }) => {
    const url = String(input)
    if (url.includes('/ilink/bot/getupdates')) {
      polled += 1
      if (polled === 1)
        return responders(url, init)
      return new Promise((resolve, reject) => {
        const onAbort = (): void => reject(new Error('aborted'))
        init?.signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
    return responders(url, init)
  })
}

async function startTransport(): Promise<{ transport: ReturnType<typeof createWeixinTransport>, onMessage: ReturnType<typeof vi.fn> }> {
  const transport = createWeixinTransport(CREDENTIAL)
  const onMessage = vi.fn()
  installFetchMock(() => jsonResponse({ ret: 0, msgs: [nonTextMessage('u1')] }))
  await transport.start({ onMessage, onConnectionChange: () => {} })
  // 等第一轮长轮询完成并注入 context_token / messageUsers
  await new Promise(resolve => setTimeout(resolve, 30))
  return { transport, onMessage }
}

describe('微信 transport sendText', () => {
  afterEach(() => {
    mocks.fetch.mockReset()
    vi.useRealTimers()
  })

  it('没有 context_token 时拒绝发送', async () => {
    const transport = createWeixinTransport(CREDENTIAL)
    await expect(transport.sendText('u1', '回复')).rejects.toThrow('尚未收到该用户的微信消息')
  })

  it('session 过期时去掉 context_token 重试一次并成功', async () => {
    const { transport } = await startTransport()
    let attempts = 0
    const sentBodies: Array<Record<string, unknown>> = []
    installFetchMock((url, init) => {
      if (url.includes('/ilink/bot/sendmessage')) {
        attempts += 1
        if (attempts === 1)
          return jsonResponse({ ret: -14, errcode: -14, errmsg: 'session expired' })
        sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
        return jsonResponse({ message_id: 'm2' })
      }
      return jsonResponse({})
    })

    const result = await transport.sendText('u1', '回复')

    expect(attempts).toBe(2)
    expect(result).toEqual({ messageId: 'm2' })
    const msg = (sentBodies[0]?.msg ?? {}) as Record<string, unknown>
    expect(msg.context_token).toBeUndefined()
    await transport.stop()
  })

  it('限流时退避重试成功', async () => {
    process.env.WEIXIN_SEND_CHUNK_RETRIES = '2'
    process.env.WEIXIN_SEND_CHUNK_RETRY_DELAY_MS = '1'
    const { transport } = await startTransport()
    let attempts = 0
    installFetchMock((url) => {
      if (url.includes('/ilink/bot/sendmessage')) {
        attempts += 1
        if (attempts === 1)
          return jsonResponse({ ret: -2, errcode: -2, errmsg: 'frequency limit' })
        return jsonResponse({ message_id: 'm3' })
      }
      return jsonResponse({})
    })

    const result = await transport.sendText('u1', '回复')

    expect(attempts).toBe(2)
    expect(result).toEqual({ messageId: 'm3' })
    await transport.stop()
  })

  it('网络错误按退避重试后成功', async () => {
    process.env.WEIXIN_SEND_CHUNK_RETRIES = '2'
    process.env.WEIXIN_SEND_CHUNK_RETRY_DELAY_MS = '1'
    const { transport } = await startTransport()
    let attempts = 0
    installFetchMock((url) => {
      if (url.includes('/ilink/bot/sendmessage')) {
        attempts += 1
        if (attempts === 1)
          throw new Error('network down')
        return jsonResponse({ message_id: 'm4' })
      }
      return jsonResponse({})
    })

    const result = await transport.sendText('u1', '回复')

    expect(attempts).toBe(2)
    expect(result).toEqual({ messageId: 'm4' })
    await transport.stop()
  })
})

describe('微信 transport 入站批处理', () => {
  afterEach(() => {
    mocks.fetch.mockReset()
    vi.useRealTimers()
  })

  it('同会话连续文本消息合并为一条后回调', async () => {
    process.env.WEIXIN_TEXT_BATCH_DELAY_MS = '20'
    const transport = createWeixinTransport(CREDENTIAL)
    const onMessage = vi.fn()
    installFetchMock((url) => {
      if (url.includes('/ilink/bot/msg/notifystart') || url.includes('/ilink/bot/msg/notifystop'))
        return jsonResponse({})
      return jsonResponse({ ret: 0, msgs: [textMessage('u1', '第一条'), textMessage('u1', '第二条')] })
    })
    await transport.start({ onMessage, onConnectionChange: () => {} })

    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1))

    const merged = (onMessage.mock.calls[0]?.[0] as { item_list?: Array<{ text_item?: { text?: string } }> }).item_list?.[0]
    expect(merged?.text_item?.text).toBe('第一条\n第二条')
    await transport.stop()
  })

  it('非文本消息不合并直接回调', async () => {
    const { transport, onMessage } = await startTransport()
    expect(onMessage).toHaveBeenCalledTimes(1)
    const event = onMessage.mock.calls[0]?.[0] as { msg_id?: string }
    expect(event.msg_id).toBe('media-u1')
    await transport.stop()
  })
})

describe('微信 transport typing', () => {
  afterEach(() => {
    mocks.fetch.mockReset()
    vi.useRealTimers()
  })

  it('typing ticket 过期后重新拉取再发送', async () => {
    const { transport } = await startTransport()
    let getConfigCalls = 0
    installFetchMock((url) => {
      if (url.includes('/ilink/bot/getconfig')) {
        getConfigCalls += 1
        return jsonResponse({ typing_ticket: `ticket-${getConfigCalls}` })
      }
      if (url.includes('/ilink/bot/sendtyping'))
        return jsonResponse({})
      return jsonResponse({})
    })

    await transport.setTyping('media-u1', true)
    expect(getConfigCalls).toBe(1)

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 601_000)
    await transport.setTyping('media-u1', false)
    expect(getConfigCalls).toBe(2)
    await transport.stop()
  })
})

describe('微信 transport sendFile', () => {
  afterEach(() => {
    mocks.fetch.mockReset()
    mocks.randomBytes.mockReset()
    mocks.randomBytes.mockImplementation((size: number) => Buffer.alloc(size, 0x5A))
    delete process.env.WEIXIN_CDN_BASE_URL
  })

  function binaryResponse(body: string, header?: { name: string, value: string }): { ok: boolean, status: number, headers: { get: (name: string) => string | null }, text: () => Promise<string> } {
    return {
      ok: true,
      status: 200,
      headers: { get: name => header && name.toLowerCase() === header.name ? header.value : null },
      text: async () => body,
    }
  }

  it('按 iLink 媒体协议上传并发送：filesize 补位、aes_key 为 base64(hex)、密文 POST 到 CDN', async () => {
    // 固定 filekey 与 aes key，便于验证 URL、密文与加密字段。
    mocks.randomBytes.mockImplementation((size: number) => size === 4
      ? Buffer.from([1, 2, 3, 4])
      : Buffer.from('0123456789abcdef'))
    const { transport } = await startTransport()
    const plaintext = Buffer.from('微信文件内容，需要 AES 加密')
    const ciphertext = encryptTestCiphertext(plaintext, Buffer.from('0123456789abcdef'))
    let uploadUrl = ''
    let uploadBody: Buffer | undefined
    let sendMessageBody: Record<string, unknown> | undefined
    installFetchMock((url, init) => {
      if (url.includes('/ilink/bot/getuploadurl')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        expect(body).toEqual(expect.objectContaining({
          filekey: '30313233343536373839616263646566',
          media_type: 3,
          to_user_id: 'u1',
          rawsize: plaintext.byteLength,
          rawfilemd5: createHash('md5').update(plaintext).digest('hex'),
          filesize: Math.ceil(plaintext.byteLength / 16) * 16,
          no_need_thumb: true,
          aeskey: '30313233343536373839616263646566',
        }))
        return jsonResponse({ upload_full_url: 'https://cdn.example/upload' })
      }
      if (url.includes('/upload')) {
        uploadUrl = url
        uploadBody = init?.body as Buffer | undefined
        return binaryResponse('ok', { name: 'x-encrypted-param', value: 'encrypted-param-1' })
      }
      if (url.includes('/ilink/bot/sendmessage')) {
        sendMessageBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonResponse({ message_id: 'media-message-1' })
      }
      return jsonResponse({})
    })

    const result = await transport.sendFile('u1', {
      name: '报告.txt',
      mediaType: 'text/plain',
      kind: 'file',
      data: plaintext.toString('base64'),
    })

    expect(result).toEqual({ messageId: 'media-message-1' })
    expect(uploadUrl).toBe('https://cdn.example/upload')
    expect(uploadBody?.equals(ciphertext)).toBe(true)
    const msg = sendMessageBody?.msg as Record<string, unknown>
    expect(msg).toEqual(expect.objectContaining({
      to_user_id: 'u1',
      context_token: 'ctx-u1',
      message_type: 2,
      message_state: 2,
    }))
    expect(msg.item_list).toEqual([
      {
        type: 4,
        file_item: {
          media: {
            encrypt_query_param: 'encrypted-param-1',
            aes_key: Buffer.from('30313233343536373839616263646566').toString('base64'),
            encrypt_type: 1,
          },
          file_name: '报告.txt',
          len: String(plaintext.byteLength),
        },
      },
    ])
    await transport.stop()
  })

  it('图片按 image_item 发送，upload_param 回退构造 CDN URL', async () => {
    mocks.randomBytes.mockImplementation((size: number) => size === 4
      ? Buffer.from([1, 2, 3, 4])
      : Buffer.from('0123456789abcdef'))
    process.env.WEIXIN_CDN_BASE_URL = 'https://cdn-base.example/c2c'
    const { transport } = await startTransport()
    const plaintext = Buffer.from('fake-jpeg')
    let uploadUrl = ''
    let mediaItem: unknown
    installFetchMock((url, init) => {
      if (url.includes('/ilink/bot/getuploadurl')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        expect(body.media_type).toBe(1)
        return jsonResponse({ upload_param: 'param-with-specials&=x' })
      }
      if (url.includes('/upload')) {
        uploadUrl = url
        return binaryResponse('ok', { name: 'x-encrypted-param', value: 'encrypted-param-2' })
      }
      if (url.includes('/ilink/bot/sendmessage')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        mediaItem = (body.msg as Record<string, unknown>).item_list
        return jsonResponse({ message_id: 'media-message-2' })
      }
      return jsonResponse({})
    })

    await transport.sendFile('u1', {
      name: '截图.png',
      mediaType: 'image/png',
      kind: 'image',
      data: plaintext.toString('base64'),
    })

    expect(uploadUrl).toBe('https://cdn-base.example/c2c/upload?encrypted_query_param=param-with-specials%26%3Dx&filekey=30313233343536373839616263646566')
    expect(mediaItem).toEqual([
      {
        type: 2,
        image_item: {
          media: {
            encrypt_query_param: 'encrypted-param-2',
            aes_key: Buffer.from('30313233343536373839616263646566').toString('base64'),
            encrypt_type: 1,
          },
          mid_size: 16,
        },
      },
    ])
    await transport.stop()
  })

  it('cDN 上传缺少 x-encrypted-param 时报错', async () => {
    const { transport } = await startTransport()
    installFetchMock((url) => {
      if (url.includes('/ilink/bot/getuploadurl'))
        return jsonResponse({ upload_full_url: 'https://cdn.example/upload' })
      if (url.includes('/upload'))
        return binaryResponse('unexpected')
      return jsonResponse({})
    })

    await expect(transport.sendFile('u1', {
      name: 'a.txt',
      mediaType: 'text/plain',
      kind: 'file',
      data: Buffer.from('hello').toString('base64'),
    })).rejects.toThrow('缺少 x-encrypted-param')
    await transport.stop()
  })
})

/** 与 transport 相同的 AES-128-ECB + PKCS7 加密，用于断言 CDN 上传密文。 */
function encryptTestCiphertext(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}
