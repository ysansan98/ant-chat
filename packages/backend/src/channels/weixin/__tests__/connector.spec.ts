import { describe, expect, it } from 'vitest'
import { normalizeWeixinEvent } from '../connector'

describe('微信 connector adapter', () => {
  it('只把微信文本 item 归一化', () => {
    expect(normalizeWeixinEvent({
      msg_id: 1,
      from_user_id: 'u1',
      to_user_id: 'bot',
      item_list: [{ type: 1, text: '你好' }],
    })).toEqual(expect.objectContaining({
      externalMessageId: '1',
      text: '你好',
    }))
  })
})
