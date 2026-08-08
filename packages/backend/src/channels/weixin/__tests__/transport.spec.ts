import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWeixinTransport } from '../transport'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('undici', () => ({ fetch: mocks.fetch }))

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
function installFetchMock(responders: (url: string, init?: { signal?: AbortSignal, body?: string }) => unknown): void {
  let polled = 0
  mocks.fetch.mockImplementation((input: unknown, init?: { signal?: AbortSignal, body?: string }) => {
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
        sentBodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>)
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
