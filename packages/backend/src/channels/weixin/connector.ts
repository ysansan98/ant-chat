/* eslint-disable style/max-statements-per-line */

import type { ChannelConnector, ChannelSendInput, ChannelSendResult, ChannelSetupInput } from '../channelConnector'
import type { ChannelInboundEvent } from '../channelRuntime'

export interface WeixinTransport { start: (onEvent: (event: unknown) => Promise<void>) => Promise<void>, stop: () => Promise<void>, sendText: (chatId: string, text: string) => Promise<{ messageId: string }> }
export class WeixinConnector implements ChannelConnector {
  readonly type = 'weixin' as const
  private status: ReturnType<ChannelConnector['getStatus']> = { status: 'disconnected' }
  constructor(private readonly transport: WeixinTransport) {}
  async setup(input: ChannelSetupInput) { return { channelAccountId: input.channelAccountId, configured: true } }
  async start(input: { channelAccountId: string, onInbound: (event: ChannelInboundEvent) => Promise<void> }) {
    this.status = { status: 'connecting' }; try {
      await this.transport.start(async (event) => {
        const normalized = normalizeWeixinEvent(event); if (normalized)
          await input.onInbound({ ...normalized, channelAccountId: input.channelAccountId })
      }); this.status = { status: 'connected' }
    }
    catch (error) { this.status = { status: 'degraded', lastError: error instanceof Error ? error.message : String(error) }; throw error }
  }

  async stop() { await this.transport.stop(); this.status = { status: 'disconnected' } }
  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const text = input.content.kind === 'text'
      ? input.content.text
      : input.content.kind === 'execution'
        ? `${input.content.text}\n\n模型：${input.content.model.provider} / ${input.content.model.model}`
        : input.content.kind === 'model-selection'
          ? input.content.models.map(model => `${model.selected ? '✓ ' : ''}${model.label}`).join('\n')
          : input.content.kind === 'permission-mode-selection'
            ? input.content.modes.map(mode => `${mode.selected ? '✓ ' : ''}${mode.label}`).join('\n')
            : `${input.content.title}\n${input.content.text}`
    const result = await this.transport.sendText(input.externalChatId, text)
    return { externalMessageId: result.messageId }
  }

  getStatus() { return this.status }
}
export function normalizeWeixinEvent(value: unknown): ChannelInboundEvent | undefined {
  const event = value as { msg_id?: string | number, from_user_id?: string, from_user_name?: string, to_user_id?: string, context_token?: string, item_list?: Array<{ type?: number, text?: string }> }
  const text = event.item_list?.find(item => item.type === 1)?.text
  if (!event.msg_id || !event.from_user_id || !event.to_user_id || !text)
    return undefined
  return { channelAccountId: '', channelType: 'weixin', externalUserId: event.from_user_id, externalDisplayName: event.from_user_name ?? event.from_user_id, externalChatId: event.from_user_id, externalMessageId: String(event.msg_id), text }
}
