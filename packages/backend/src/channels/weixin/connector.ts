/* eslint-disable style/max-statements-per-line */

import type { SystemLogger } from '../../systemLogger'
import type { ChannelActionEvent, ChannelActionResult, ChannelConnector, ChannelSendInput, ChannelSendResult, ChannelSetupInput } from '../channelConnector'
import type { ChannelInboundEvent } from '../channelRuntime'
import type { WeixinTransport } from './transport'

export class WeixinConnector implements ChannelConnector {
  readonly type = 'weixin' as const
  private status: ReturnType<ChannelConnector['getStatus']> = { status: 'disconnected' }
  private activeTransport?: WeixinTransport
  private readonly transportFactory?: (credential: string) => WeixinTransport
  constructor(transport: WeixinTransport | ((credential: string) => WeixinTransport), private readonly logger?: Pick<SystemLogger, 'info' | 'warn'>) {
    if (typeof transport === 'function')
      this.transportFactory = transport
    else
      this.activeTransport = transport
  }

  async setup(input: ChannelSetupInput) { return { channelAccountId: input.channelAccountId, configured: true } }
  async start(input: {
    channelAccountId: string
    credential?: string
    onInbound: (event: ChannelInboundEvent) => Promise<void>
    onAction: (event: ChannelActionEvent) => Promise<ChannelActionResult>
  }) {
    this.status = { status: 'connecting' }
    // 重新授权时会再次 start：先停掉旧 transport，避免两个长轮询抢同一 bot token。
    if (this.activeTransport)
      await this.activeTransport.stop().catch(() => undefined)
    const transport = this.transportFactory ? this.transportFactory(input.credential ?? '') : this.activeTransport!
    this.activeTransport = transport
    try {
      await transport.start({
        onMessage: async (event) => {
          const normalized = normalizeWeixinEvent(event)
          if (normalized) {
            await input.onInbound({ ...normalized, channelAccountId: input.channelAccountId })
          }
          else {
            const structure = inspectWeixinEvent(event)
            this.logger?.warn('[消息频道] 忽略不支持的微信入站消息', structure)
          }
        },
        onConnectionChange: (status, lastError) => {
          this.status = status === 'connected' ? { status: 'connected' } : { status: 'degraded', lastError }
        },
      })
      this.status = { status: 'connected' }
    }
    catch (error) {
      this.status = { status: 'degraded', lastError: error instanceof Error ? error.message : String(error) }
      throw error
    }
  }

  async stop() { await this.activeTransport?.stop().catch(() => undefined); this.activeTransport = undefined; this.status = { status: 'disconnected' } }
  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    if (!this.activeTransport)
      throw new Error('微信频道尚未连接')
    const text = input.content.kind === 'text'
      ? input.content.text
      : input.content.kind === 'execution'
        ? input.content.text
        : input.content.kind === 'model-selection'
          ? input.content.models.map(model => `${model.selected ? '✓ ' : ''}${model.label}`).join('\n')
          : input.content.kind === 'permission-mode-selection'
            ? input.content.modes.map(mode => `${mode.selected ? '✓ ' : ''}${mode.label}`).join('\n')
            : `${input.content.title}\n${input.content.text}`
    const result = await this.activeTransport.sendText(input.externalChatId, text)
    return { externalMessageId: result.messageId }
  }

  async setTyping(input: { externalMessageId: string, typing: boolean }) {
    if (!this.activeTransport)
      throw new Error('微信频道尚未连接')
    return this.activeTransport.setTyping(input.externalMessageId, input.typing)
  }

  getStatus() { return this.status }
}

function inspectWeixinEvent(value: unknown): Record<string, unknown> {
  const event = value as Record<string, unknown>
  const items = Array.isArray(event.item_list) ? event.item_list : undefined
  return {
    keys: Object.keys(event).sort(),
    msgIdType: typeof event.msg_id,
    msgIdValueType: typeof event.message_id,
    msgIdValueType2: typeof event.seq,
    fromUserIdType: typeof event.from_user_id,
    toUserIdType: typeof event.to_user_id,
    itemTypes: items?.map(item => (item as { type?: unknown }).type) ?? null,
    itemKeys: items?.map(item => Object.keys(item as Record<string, unknown>).sort()) ?? null,
    textShapes: items?.map((item) => {
      const textItem = (item as { text_item?: unknown }).text_item
      return textItem ? Object.keys(textItem as Record<string, unknown>).sort() : null
    }) ?? null,
    textItemValues: items?.map((item) => {
      const textItem = (item as { text_item?: { text?: unknown } }).text_item
      return textItem ? String(textItem.text ?? '').slice(0, 50) : null
    }) ?? null,
    hasContextToken: typeof event.context_token === 'string' && Boolean(event.context_token),
  }
}

export function normalizeWeixinEvent(value: unknown): ChannelInboundEvent | undefined {
  const event = value as {
    msg_id?: string | number
    message_id?: string | number
    seq?: string | number
    from_user_id?: string
    from_user_name?: string
    item_list?: Array<{ type?: number, text?: string, text_item?: { text?: string } }>
  }
  const textItem = event.item_list?.find(item => item.type === 1)
  const text = textItem?.text_item?.text ?? textItem?.text
  const externalMessageId = event.msg_id ?? event.message_id ?? event.seq
  if (!externalMessageId || !event.from_user_id || !text)
    return undefined
  return { channelAccountId: '', channelType: 'weixin', externalUserId: event.from_user_id, externalDisplayName: event.from_user_name ?? event.from_user_id, externalChatId: event.from_user_id, externalMessageId: String(externalMessageId), text }
}
