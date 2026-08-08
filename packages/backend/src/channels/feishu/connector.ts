import type { ChannelActionEvent, ChannelActionResult, ChannelAttachment, ChannelConnector, ChannelOutboundContent, ChannelSendInput, ChannelSendResult, ChannelSetupInput, ChannelUpdateInput } from '../channelConnector'
import type { ChannelInboundEvent } from '../channelRuntime'
import { createConnectorState } from '../channelConnector'

export interface FeishuTransport {
  connect: (handlers: {
    onMessage: (event: unknown) => Promise<void>
    onAction: (event: unknown) => Promise<ChannelActionResult>
  }) => Promise<void>
  close: () => Promise<void>
  sendText: (chatId: string, text: string) => Promise<{ messageId: string }>
  sendFile: (chatId: string, attachment: ChannelAttachment) => Promise<{ messageId: string }>
  createCard: (chatId: string, content: Exclude<ChannelOutboundContent, { kind: 'text' }>) => Promise<{ messageId: string }>
  updateCard: (messageId: string, content: Exclude<ChannelOutboundContent, { kind: 'text' }>) => Promise<void>
  setTyping: (messageId: string, typing: boolean) => Promise<{ changed: boolean }>
}

export class FeishuConnector implements ChannelConnector {
  readonly type = 'feishu' as const
  readonly capabilities = { supportsUpdate: true } as const
  private readonly state = createConnectorState<FeishuTransport>()
  private readonly transportFactory?: (credential: string) => FeishuTransport
  constructor(transport: FeishuTransport | ((credential: string) => FeishuTransport), private readonly logger?: Pick<Console, 'info' | 'warn'>) {
    if (typeof transport === 'function')
      this.transportFactory = transport
    else
      this.state.activeTransport = transport
  }

  async setup(input: ChannelSetupInput) { return { channelAccountId: input.channelAccountId, configured: true } }
  async start(input: {
    channelAccountId: string
    credential?: string
    onInbound: (event: ChannelInboundEvent) => Promise<void>
    onAction: (event: ChannelActionEvent) => Promise<ChannelActionResult>
  }) {
    this.state.beginConnect()
    try {
      const transport = this.transportFactory ? this.transportFactory(input.credential ?? '') : this.state.activeTransport!
      this.state.activeTransport = transport
      await transport.connect({
        onMessage: async (event) => {
          const structure = inspectFeishuEvent(event)
          this.logger?.info('[消息频道] 飞书入站消息结构', structure)
          const normalized = normalizeFeishuEvent(event)
          if (normalized)
            await input.onInbound({ ...normalized, channelAccountId: input.channelAccountId })
          else
            this.logger?.warn('[消息频道] 忽略不支持的飞书入站消息', structure)
        },
        onAction: async (event) => {
          const normalized = normalizeFeishuActionEvent(event)
          if (!normalized)
            return { status: 'error', message: '卡片操作无效或已过期。' }
          return input.onAction({ ...normalized, channelAccountId: input.channelAccountId })
        },
      })
      this.state.setConnected()
    }
    catch (error) {
      this.state.setDegraded(error)
      throw error
    }
  }

  async stop() { await this.state.stopActive(transport => transport.close()) }
  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const transport = this.state.activeTransport
    if (!transport)
      throw new Error('飞书频道尚未连接')
    let lastMessageId = ''
    const primary = input.content.kind === 'text'
      ? await transport.sendText(input.externalChatId, input.content.text)
      : await transport.createCard(input.externalChatId, input.content)
    lastMessageId = primary.messageId
    // 飞书不支持"文本/卡片+附件"一条消息，附件作为独立消息顺序发送；
    // 单个附件失败只告警并继续，不阻断主内容与后续附件。
    for (const attachment of input.content.attachments ?? []) {
      try {
        const result = await transport.sendFile(input.externalChatId, attachment)
        lastMessageId = result.messageId
      }
      catch (error) {
        this.logger?.warn('[消息频道] 飞书附件发送失败', {
          name: attachment.name,
          kind: attachment.kind,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { externalMessageId: lastMessageId }
  }

  async update(input: ChannelUpdateInput): Promise<void> {
    const transport = this.state.activeTransport
    if (!transport)
      throw new Error('飞书频道尚未连接')
    await transport.updateCard(input.externalMessageId, input.content)
  }

  async setTyping(input: { externalMessageId: string, typing: boolean }) {
    const transport = this.state.activeTransport
    if (!transport)
      throw new Error('飞书频道尚未连接')
    return transport.setTyping(input.externalMessageId, input.typing)
  }

  async sendAttachment(input: { externalChatId: string, attachment: import('@ant-chat/shared').ChannelAttachment }) {
    const transport = this.state.activeTransport
    if (!transport)
      throw new Error('飞书频道尚未连接')
    // 失败直接向上抛，由工具层呈现给模型，不静默吞掉。
    return transport.sendFile(input.externalChatId, input.attachment)
  }

  getStatus() { return this.state.getStatus() }
}

export function normalizeFeishuActionEvent(value: unknown): Omit<ChannelActionEvent, 'channelAccountId'> | undefined {
  const envelope = value as { header?: { event_id?: string, event_type?: string }, event?: FeishuCardActionPayload }
  const payload = envelope.event ?? value as FeishuCardActionPayload
  const eventType = envelope.header?.event_type ?? payload.event_type ?? 'card.action.trigger'
  const actionValue = isRecord(payload.action?.value) ? payload.action.value : undefined
  const actionToken = actionValue && typeof actionValue.token === 'string' ? actionValue.token : undefined
  const formValues = isRecord(payload.action?.form_value)
    ? Object.fromEntries(Object.entries(payload.action.form_value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : undefined
  const externalEventId = envelope.header?.event_id ?? payload.event_id
  const externalUserId = payload.operator?.open_id
  const externalChatId = payload.context?.open_chat_id ?? payload.open_chat_id
  const externalMessageId = payload.context?.open_message_id ?? payload.open_message_id
  if (eventType !== 'card.action.trigger' || !externalEventId || !externalUserId || !externalChatId || !externalMessageId || !actionToken)
    return undefined
  return { externalEventId, externalUserId, externalChatId, externalMessageId, actionToken, ...(formValues ? { formValues } : {}) }
}

export function normalizeFeishuEvent(value: unknown): ChannelInboundEvent | undefined {
  const envelope = value as { header?: { event_id?: string, event_type?: string }, event?: FeishuEventPayload }
  const payload = envelope.event ?? value as FeishuEventPayload
  const eventType = envelope.header?.event_type ?? 'im.message.receive_v1'
  const eventId = envelope.header?.event_id ?? payload.event_id ?? payload.message?.message_id
  const message = payload.message
  const sender = payload.sender
  if (eventType !== 'im.message.receive_v1' || !message || message.chat_type !== 'p2p' || !['text', 'post'].includes(message.message_type ?? '') || sender?.sender_type !== 'user' || !eventId || !message.message_id || !message.chat_id || !sender.sender_id?.open_id)
    return undefined
  const parsed = parseFeishuMessageContent(message)
  if (!parsed)
    return undefined
  const text = message.message_type === 'post' ? extractPostText(parsed.content) : getString(parsed.content, 'text')
  if (!text)
    return undefined
  return { channelAccountId: '', channelType: 'feishu', externalUserId: sender.sender_id.open_id, externalDisplayName: sender.sender_id.open_id, externalChatId: message.chat_id, externalMessageId: message.message_id || eventId, text }
}

interface FeishuEventPayload {
  event_id?: string
  message?: { message_id?: string, chat_id?: string, chat_type?: string, message_type?: string, content?: string, content_v2?: string }
  sender?: { sender_id?: { open_id?: string }, sender_type?: string }
}

interface FeishuCardActionPayload {
  event_id?: string
  event_type?: string
  context?: { open_chat_id?: string, open_message_id?: string }
  open_chat_id?: string
  open_message_id?: string
  operator?: { open_id?: string }
  action?: { value?: unknown, form_value?: unknown }
}

function inspectFeishuEvent(value: unknown) {
  const envelope = value as { header?: { event_type?: string }, event?: FeishuEventPayload }
  const payload = envelope.event ?? value as FeishuEventPayload
  const message = payload.message
  const parsed = message ? parseFeishuMessageContent(message) : undefined
  const post = parsed && message?.message_type === 'post' ? getPostBody(parsed.content) : undefined
  const paragraphs = post ? getParagraphs(post) : []
  const tags = [...new Set(paragraphs.flatMap(paragraph => paragraph.map(element => getString(element, 'tag')).filter(Boolean)))].sort()
  return {
    eventType: envelope.header?.event_type ?? 'im.message.receive_v1',
    messageId: message?.message_id,
    chatType: message?.chat_type,
    messageType: message?.message_type,
    contentJsonValid: Boolean(parsed),
    contentKeys: parsed ? Object.keys(parsed.content).sort() : [],
    ...(parsed ? { contentSource: parsed.source } : {}),
    ...(parsed ? { contentShape: describeJsonShape(parsed.content) } : {}),
    ...(post ? { postParagraphCount: paragraphs.length, postElementTags: tags } : {}),
  }
}

function parseFeishuMessageContent(message: NonNullable<FeishuEventPayload['message']>): { content: Record<string, unknown>, source: 'content' | 'content_v2' } | undefined {
  for (const [source, value] of [['content_v2', message.content_v2], ['content', message.content]] as const) {
    if (!value)
      continue
    try {
      const content = JSON.parse(value) as unknown
      if (isRecord(content))
        return { content, source }
    }
    catch {
      // 结构日志会记录 contentJsonValid=false，正文不写入日志。
    }
  }
  return undefined
}

function extractPostText(content: Record<string, unknown>): string | undefined {
  const post = getPostBody(content)
  if (!post)
    return undefined
  const title = getString(post, 'title')
  const paragraphs = getParagraphs(post)
    .map(paragraph => paragraph.map(elementToText).join(''))
    .filter(paragraph => paragraph.trim())
  const text = [title, ...paragraphs].filter(Boolean).join('\n').trim()
  return text || undefined
}

function getPostBody(content: Record<string, unknown>): Record<string, unknown> | undefined {
  const root = isRecord(content.post) ? content.post : content
  if (Array.isArray(root.content))
    return root
  for (const locale of ['zh_cn', 'en_us', 'ja_jp']) {
    if (isRecord(root[locale]) && Array.isArray(root[locale].content))
      return root[locale]
  }
  return Object.values(root).find(value => isRecord(value) && Array.isArray(value.content)) as Record<string, unknown> | undefined
}

function getParagraphs(post: Record<string, unknown>): Array<Array<Record<string, unknown>>> {
  if (!Array.isArray(post.content))
    return []
  return post.content
    .filter(Array.isArray)
    .map(paragraph => paragraph.filter(isRecord))
}

function elementToText(element: Record<string, unknown>): string {
  const tag = getString(element, 'tag')
  const text = getString(element, 'text') ?? getString(element, 'content') ?? ''
  if (tag === 'a') {
    const href = getString(element, 'href')
    return href && text ? `[${text}](${href})` : text
  }
  if (tag === 'at') {
    const name = getString(element, 'user_name')
    return name ? `@${name}` : ''
  }
  if (tag === 'hr')
    return '---'
  return ['text', 'md', 'code_block'].includes(tag ?? '') ? text : ''
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeJsonShape(value: unknown, depth = 0): unknown {
  if (depth >= 6)
    return typeof value
  if (Array.isArray(value))
    return value.length ? [describeJsonShape(value[0], depth + 1)] : []
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, describeJsonShape(value[key], depth + 1)]),
    )
  }
  if (value === null)
    return 'null'
  return typeof value
}
