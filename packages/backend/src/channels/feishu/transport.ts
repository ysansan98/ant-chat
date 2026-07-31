import type { FeishuTransport } from './connector'

import * as lark from '@larksuiteoapi/node-sdk'
import { buildFeishuCard } from './card'

/**
 * 飞书长连接只负责收发平台事件；Agent 入口仍由 FeishuConnector 和 ChannelRuntime 持有。
 * 这样第三方 SDK 不会直接接触 Agent loop。
 */
export function createFeishuTransport(credential: string, logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'>): FeishuTransport {
  const { appId, appSecret } = parseCredential(credential)
  const client = new lark.Client({ appId, appSecret, loggerLevel: lark.LoggerLevel.warn })
  const typingReactionIds = new Map<string, string>()
  let wsClient: lark.WSClient | undefined

  return {
    async connect(handlers) {
      const eventDispatcher = new lark.EventDispatcher({ loggerLevel: lark.LoggerLevel.warn }).register({
        'im.message.receive_v1': async (event) => {
          logger?.info('[消息频道] 飞书 SDK 收到 im.message.receive_v1')
          await handlers.onMessage(event)
        },
        'card.action.trigger': async (event: unknown) => {
          const context = inspectFeishuCardAction(event)
          logger?.info('[消息频道] 飞书 SDK 收到卡片操作', context)
          try {
            const result = await handlers.onAction(event)
            const response = {
              toast: {
                type: result.status,
                content: result.message,
              },
              ...(result.updatedContent
                ? { card: { type: 'raw', data: buildFeishuCard(result.updatedContent) } }
                : {}),
            }
            logger?.info('[消息频道] 飞书卡片操作即将响应', {
              eventId: context.eventId,
              messageId: context.messageId,
              status: result.status,
              hasUpdatedCard: Boolean(result.updatedContent),
            })
            return response
          }
          catch (error) {
            logger?.error('[消息频道] 飞书卡片操作处理异常', {
              eventId: context.eventId,
              messageId: context.messageId,
              error,
            })
            throw error
          }
        },
      })
      wsClient = new lark.WSClient({
        appId,
        appSecret,
        loggerLevel: lark.LoggerLevel.warn,
        onReady: () => logger?.info('[消息频道] 飞书 WebSocket 已连接'),
        onReconnecting: () => logger?.warn('[消息频道] 飞书 WebSocket 正在重连'),
        onReconnected: () => logger?.info('[消息频道] 飞书 WebSocket 已重连'),
        onError: error => logger?.error('[消息频道] 飞书 WebSocket 连接失败', error),
      })
      await wsClient.start({ eventDispatcher })
    },
    async close() {
      await Promise.allSettled([...typingReactionIds].map(([messageId, reactionId]) => client.im.v1.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      })))
      typingReactionIds.clear()
      wsClient?.close({ force: true })
      wsClient = undefined
    },
    async sendText(chatId, text) {
      const response = await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      })
      const messageId = response.data?.message_id
      if (!messageId)
        throw new Error('飞书发送消息未返回 message_id')
      return { messageId }
    },
    async createCard(chatId, content) {
      const response = await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(buildFeishuCard(content)),
        },
      })
      const messageId = response.data?.message_id
      if (!messageId)
        throw new Error('飞书发送卡片未返回 message_id')
      return { messageId }
    },
    async updateCard(messageId, content) {
      await client.im.v1.message.patch({
        path: { message_id: messageId },
        data: { content: JSON.stringify(buildFeishuCard(content)) },
      })
    },
    async setTyping(messageId, typing) {
      const reactionId = typingReactionIds.get(messageId)
      if (typing) {
        if (reactionId)
          return { changed: false }
        const response = await client.im.v1.messageReaction.create({
          path: { message_id: messageId },
          data: { reaction_type: { emoji_type: 'Typing' } },
        })
        const createdReactionId = response.data?.reaction_id
        if (!createdReactionId)
          throw new Error('飞书添加 typing 状态未返回 reaction_id')
        typingReactionIds.set(messageId, createdReactionId)
        return { changed: true }
      }
      if (!reactionId)
        return { changed: false }
      await client.im.v1.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      })
      typingReactionIds.delete(messageId)
      return { changed: true }
    },
  }
}

function inspectFeishuCardAction(value: unknown): { eventId?: string, eventType?: string, messageId?: string } {
  const envelope = value as {
    header?: { event_id?: string, event_type?: string }
    event?: { event_id?: string, event_type?: string, context?: { open_message_id?: string }, open_message_id?: string }
  }
  const payload = envelope.event ?? value as NonNullable<typeof envelope.event>
  return {
    eventId: envelope.header?.event_id ?? payload.event_id,
    eventType: envelope.header?.event_type ?? payload.event_type,
    messageId: payload.context?.open_message_id ?? payload.open_message_id,
  }
}

function parseCredential(value: string): { appId: string, appSecret: string } {
  try {
    const parsed = JSON.parse(value) as { appId?: unknown, appSecret?: unknown }
    if (typeof parsed.appId === 'string' && parsed.appId && typeof parsed.appSecret === 'string' && parsed.appSecret)
      return { appId: parsed.appId, appSecret: parsed.appSecret }
  }
  catch {
    // 统一转换为用户可理解的配置错误，不把凭证内容写入日志。
  }
  throw new Error('飞书频道凭证格式无效')
}
