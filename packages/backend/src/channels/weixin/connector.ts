/* eslint-disable style/max-statements-per-line */

import type { SystemLogger } from '../../systemLogger'

import type { ChannelActionEvent, ChannelActionResult, ChannelConnector, ChannelSendInput, ChannelSendResult, ChannelSetupInput } from '../channelConnector'
import type { ChannelInboundEvent } from '../channelRuntime'
import type { WeixinTransport } from './transport'
import process from 'node:process'
import { DEFAULT_WEIXIN_MAX_MESSAGE_LENGTH, splitWeixinDelivery, wrapCopyFriendlyLines } from './delivery'
import { readEnvInt } from './transport'

export interface WeixinConnectorOptions {
  /** 单条微信文本上限，超出按 Markdown 块拆分。 */
  maxMessageLength: number
  /** 相邻拆分消息的发送间隔（毫秒），0 表示不等待（测试用）。 */
  chunkDelayMs: number
  /** legacy 模式：顶层换行即独立消息。默认 false（紧凑模式）。 */
  splitPerLine: boolean
}

function resolveConnectorOptions(overrides?: Partial<WeixinConnectorOptions>): WeixinConnectorOptions {
  return {
    maxMessageLength: readEnvInt('WEIXIN_MAX_MESSAGE_LENGTH', DEFAULT_WEIXIN_MAX_MESSAGE_LENGTH),
    chunkDelayMs: readEnvInt('WEIXIN_SEND_CHUNK_DELAY_MS', 1500),
    splitPerLine: process.env.WEIXIN_SPLIT_MULTILINE_MESSAGES === 'true',
    ...overrides,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class WeixinConnector implements ChannelConnector {
  readonly type = 'weixin' as const
  private status: ReturnType<ChannelConnector['getStatus']> = { status: 'disconnected' }
  private activeTransport?: WeixinTransport
  private readonly transportFactory?: (credential: string) => WeixinTransport
  private readonly options: WeixinConnectorOptions
  constructor(transport: WeixinTransport | ((credential: string) => WeixinTransport), private readonly logger?: Pick<SystemLogger, 'info' | 'warn'>, options?: Partial<WeixinConnectorOptions>) {
    this.options = resolveConnectorOptions(options)
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
    // 微信不能编辑消息，回复必须整段终态发出；先折行再按块拆分，
    // 逐条顺序发送，块间隔避免连续消息触发 iLink 限流。
    const chunks = splitWeixinDelivery(wrapCopyFriendlyLines(text), this.options.maxMessageLength, this.options.splitPerLine)
    let lastMessageId = ''
    for (let index = 0; index < chunks.length; index++) {
      const result = await this.activeTransport.sendText(input.externalChatId, chunks[index]!)
      lastMessageId = result.messageId
      if (index < chunks.length - 1 && this.options.chunkDelayMs > 0)
        await delay(this.options.chunkDelayMs)
    }
    // 附件独立于文本消息逐条发送；单个附件失败只告警并继续，不阻断后续附件。
    const attachments = input.content.attachments ?? []
    for (let index = 0; index < attachments.length; index++) {
      try {
        const result = await this.activeTransport.sendFile(input.externalChatId, attachments[index]!)
        lastMessageId = result.messageId
      }
      catch (error) {
        this.logger?.warn('[消息频道] 微信附件发送失败', {
          name: attachments[index]!.name,
          kind: attachments[index]!.kind,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      if (this.options.chunkDelayMs > 0)
        await delay(this.options.chunkDelayMs)
    }
    return { externalMessageId: lastMessageId }
  }

  async setTyping(input: { externalMessageId: string, typing: boolean }) {
    if (!this.activeTransport)
      throw new Error('微信频道尚未连接')
    return this.activeTransport.setTyping(input.externalMessageId, input.typing)
  }

  async sendAttachment(input: { externalChatId: string, attachment: import('@ant-chat/shared').ChannelAttachment }) {
    if (!this.activeTransport)
      throw new Error('微信频道尚未连接')
    // 失败直接向上抛，由工具层呈现给模型，不静默吞掉。
    return this.activeTransport.sendFile(input.externalChatId, input.attachment)
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
