import { describe, expect, it, vi } from 'vitest'
import { normalizeWeixinEvent, WeixinConnector } from '../connector'

describe('微信 connector adapter', () => {
  it('把 iLink text_item 文本归一化', () => {
    expect(normalizeWeixinEvent({
      msg_id: 1,
      from_user_id: 'u1',
      to_user_id: 'bot',
      context_token: 'token-1',
      item_list: [{ type: 1, text_item: { text: '你好' } }],
    })).toEqual(expect.objectContaining({
      externalMessageId: '1',
      text: '你好',
    }))
  })

  it('缺失文本或身份字段时不归一化', () => {
    expect(normalizeWeixinEvent({ msg_id: 2, from_user_id: 'u1', item_list: [] })).toBeUndefined()
    expect(normalizeWeixinEvent({ msg_id: 3, item_list: [{ type: 1, text: '只有文本' }] })).toBeUndefined()
  })

  it('兼容 message_id / seq 作为消息 ID', () => {
    expect(normalizeWeixinEvent({
      message_id: 'm1',
      from_user_id: 'u1',
      item_list: [{ type: 1, text_item: { text: '你好' } }],
    })).toEqual(expect.objectContaining({ externalMessageId: 'm1' }))
    expect(normalizeWeixinEvent({
      seq: 42,
      from_user_id: 'u1',
      item_list: [{ type: 1, text_item: { text: '你好' } }],
    })).toEqual(expect.objectContaining({ externalMessageId: '42' }))
  })

  it('send 按块拆分并顺序发送多条消息，返回最后一条 ID', async () => {
    const sendText = vi.fn()
      .mockResolvedValueOnce({ messageId: 'm1' })
      .mockResolvedValueOnce({ messageId: 'm2' })
    const transport = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendText,
      setTyping: vi.fn(),
    }
    const connector = new WeixinConnector(transport, undefined, { maxMessageLength: 10, chunkDelayMs: 0 })
    await connector.start({ channelAccountId: 'a1', onInbound: vi.fn(), onAction: vi.fn() })

    const result = await connector.send({ externalChatId: 'u1', content: { kind: 'text', text: '第一段\n\n第二段' } })

    expect(sendText).toHaveBeenCalledTimes(2)
    expect(sendText).toHaveBeenNthCalledWith(1, 'u1', '第一段')
    expect(sendText).toHaveBeenNthCalledWith(2, 'u1', '第二段')
    expect(result).toEqual({ externalMessageId: 'm2' })
  })

  it('短回复只发送一条', async () => {
    const sendText = vi.fn().mockResolvedValue({ messageId: 'm1' })
    const transport = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendText,
      setTyping: vi.fn(),
    }
    const connector = new WeixinConnector(transport, undefined, { maxMessageLength: 10, chunkDelayMs: 0 })
    await connector.start({ channelAccountId: 'a1', onInbound: vi.fn(), onAction: vi.fn() })

    await connector.send({ externalChatId: 'u1', content: { kind: 'text', text: '收到' } })

    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith('u1', '收到')
  })
})
