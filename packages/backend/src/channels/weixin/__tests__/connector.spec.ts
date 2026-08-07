import { describe, expect, it } from 'vitest'
import { normalizeWeixinEvent } from '../connector'

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
})
