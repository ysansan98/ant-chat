import { describe, expect, it, vi } from 'vitest'
import type { FeishuTransport } from '../connector'
import { FeishuConnector, normalizeFeishuActionEvent, normalizeFeishuEvent } from '../connector'

function createTransport(connect: FeishuTransport['connect'] = vi.fn(async () => {})) {
  return {
    connect,
    close: vi.fn(async () => {}),
    sendText: vi.fn(async () => ({ messageId: 'out-1' })),
    createCard: vi.fn(async () => ({ messageId: 'card-1' })),
    updateCard: vi.fn(async () => {}),
    setTyping: vi.fn(async () => ({ changed: true })),
  }
}

describe('频道 connector adapter', () => {
  it('只把飞书 1v1 纯文本事件归一化，群聊和媒体事件被忽略', () => {
    const base = { header: { event_id: 'e1', event_type: 'im.message.receive_v1' }, event: { sender: { sender_type: 'user', sender_id: { open_id: 'u1' } }, message: { message_id: 'm1', chat_id: 'c1', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: '你好' }) } } }
    expect(normalizeFeishuEvent(base)).toEqual(expect.objectContaining({ externalMessageId: 'm1', text: '你好', externalChatId: 'c1' }))
    expect(normalizeFeishuEvent({ ...base, event: { ...base.event, message: { ...base.event.message, chat_type: 'group' } } })).toBeUndefined()
    expect(normalizeFeishuEvent(base.event)).toEqual(expect.objectContaining({ externalMessageId: 'm1', text: '你好', externalChatId: 'c1' }))
  })

  it('把飞书 post 富文本提取为文本并记录脱敏结构', async () => {
    const event = {
      header: { event_id: 'e-post', event_type: 'im.message.receive_v1' },
      event: {
        sender: { sender_type: 'user', sender_id: { open_id: 'u1' } },
        message: {
          message_id: 'm-post',
          chat_id: 'c1',
          chat_type: 'p2p',
          message_type: 'post',
          content: JSON.stringify({
            zh_cn: {
              title: '排查请求',
              content: [
                [{ tag: 'md', text: '**错误日志**\n请检查原因' }],
                [{ tag: 'a', text: '相关文档', href: 'https://example.com/docs' }],
              ],
            },
          }),
        },
      },
    }
    const connect = vi.fn(async (handlers: { onMessage: (value: unknown) => Promise<void> }) => handlers.onMessage(event))
    const transport = createTransport(connect)
    const logger = { info: vi.fn(), warn: vi.fn() }
    const onInbound = vi.fn(async () => {})
    const connector = new FeishuConnector(transport, logger)

    await connector.start({ channelAccountId: 'a1', credential: 'credential', onInbound, onAction: vi.fn() })

    expect(onInbound).toHaveBeenCalledWith(expect.objectContaining({
      externalMessageId: 'm-post',
      text: '排查请求\n**错误日志**\n请检查原因\n[相关文档](https://example.com/docs)',
    }))
    expect(logger.info).toHaveBeenCalledWith('[消息频道] 飞书入站消息结构', {
      chatType: 'p2p',
      contentJsonValid: true,
      contentKeys: ['zh_cn'],
      contentShape: {
        zh_cn: {
          content: [[{ tag: 'string', text: 'string' }]],
          title: 'string',
        },
      },
      contentSource: 'content',
      eventType: 'im.message.receive_v1',
      messageId: 'm-post',
      messageType: 'post',
      postElementTags: ['a', 'md'],
      postParagraphCount: 2,
    })
  })

  it('普通回复发送文本，执行内容创建并更新卡片', async () => {
    const transport = createTransport()
    const connector = new FeishuConnector(transport)
    await connector.send({ externalChatId: 'c1', content: { kind: 'text', text: '回复' } })
    const execution = {
      kind: 'execution' as const,
      executionId: 'turn-1',
      status: 'running' as const,
      text: '处理中',
      model: { provider: '服务一', model: '模型一' },
      steps: [],
    }
    await connector.send({ externalChatId: 'c1', content: execution })
    await connector.update?.({ externalMessageId: 'card-1', content: execution })
    await connector.setTyping?.({ externalMessageId: 'm1', typing: true })
    await connector.setTyping?.({ externalMessageId: 'm1', typing: false })
    await connector.stop()
    expect(transport.sendText).toHaveBeenCalledWith('c1', '回复')
    expect(transport.createCard).toHaveBeenCalledWith('c1', execution)
    expect(transport.updateCard).toHaveBeenCalledWith('card-1', execution)
    expect(transport.setTyping).toHaveBeenNthCalledWith(1, 'm1', true)
    expect(transport.setTyping).toHaveBeenNthCalledWith(2, 'm1', false)
    expect(connector.getStatus()).toEqual({ status: 'disconnected' })
  })

  it('按频道账号凭证创建真实 transport，并把飞书入站事件交给运行时', async () => {
    const event = { header: { event_id: 'e1', event_type: 'im.message.receive_v1' }, event: { sender: { sender_type: 'user', sender_id: { open_id: 'u1' } }, message: { message_id: 'm1', chat_id: 'c1', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: '你好' }) } } }
    const connect = vi.fn(async (handlers: { onMessage: (value: unknown) => Promise<void> }) => handlers.onMessage(event))
    const transport = createTransport(connect)
    const factory = vi.fn(() => transport)
    const connector = new FeishuConnector(factory)
    const onInbound = vi.fn(async () => {})

    await connector.start({ channelAccountId: 'a1', credential: '{"appId":"cli_x","appSecret":"secret"}', onInbound, onAction: vi.fn() })

    expect(factory).toHaveBeenCalledWith('{"appId":"cli_x","appSecret":"secret"}')
    expect(onInbound).toHaveBeenCalledWith(expect.objectContaining({ channelAccountId: 'a1', externalMessageId: 'm1', text: '你好' }))
  })

  it('只接受带一次性 token 和完整身份上下文的飞书卡片操作', () => {
    expect(normalizeFeishuActionEvent({
      header: { event_id: 'action-1', event_type: 'card.action.trigger' },
      event: {
        operator: { open_id: 'u1' },
        context: { open_chat_id: 'chat-1', open_message_id: 'card-1' },
        action: { value: { token: 'token-1' } },
      },
    })).toEqual({
      externalEventId: 'action-1',
      externalUserId: 'u1',
      externalChatId: 'chat-1',
      externalMessageId: 'card-1',
      actionToken: 'token-1',
    })
    expect(normalizeFeishuActionEvent({
      header: { event_id: 'action-2', event_type: 'card.action.trigger' },
      event: { action: { value: { token: 'token-1' } } },
    })).toBeUndefined()
  })

  it('保留模型表单值，同时丢弃非字符串表单字段', () => {
    expect(normalizeFeishuActionEvent({
      header: { event_id: 'action-model', event_type: 'card.action.trigger' },
      event: {
        operator: { open_id: 'u1' },
        context: { open_chat_id: 'chat-1', open_message_id: 'card-1' },
        action: {
          value: { token: 'token-model' },
          form_value: { model: 'option-2', ignored: { nested: true } },
        },
      },
    })).toEqual({
      externalEventId: 'action-model',
      externalUserId: 'u1',
      externalChatId: 'chat-1',
      externalMessageId: 'card-1',
      actionToken: 'token-model',
      formValues: { model: 'option-2' },
    })
  })
})
