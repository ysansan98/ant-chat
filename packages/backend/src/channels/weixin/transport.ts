import type { ChannelAttachment } from '../channelConnector'
import type { TransportLogger } from './ilinkHttp'
import { randomUUID } from 'node:crypto'
import {
  BACKOFF_DELAY_MS,
  DEFAULT_API_BASE_URL,
  isStaleSession,
  LONG_POLL_TIMEOUT_MS,
  RATE_LIMIT_ERRCODE,
  readEnvInt,
  RETRY_DELAY_MS,
  SESSION_EXPIRED_ERRCODE,
  TEXT_BATCH_SPLIT_THRESHOLD,
  TYPING_TICKET_TTL_MS,
  weixinPost,
} from './ilinkHttp'
import { uploadMediaToIlink } from './mediaUpload'

export type { TransportLogger, WeixinQrCodeResponse, WeixinQrStatusResponse } from './ilinkHttp'
export { getWeixinBotQrcode, getWeixinQrStatus, readEnvInt } from './ilinkHttp'

export interface WeixinTransport {
  start: (handlers: {
    onMessage: (event: unknown) => Promise<void>
    onConnectionChange: (status: 'connected' | 'degraded', lastError?: string) => void
  }) => Promise<void>
  stop: () => Promise<void>
  sendText: (chatId: string, text: string) => Promise<{ messageId: string }>
  sendFile: (chatId: string, attachment: ChannelAttachment) => Promise<{ messageId: string }>
  setTyping: (messageId: string, typing: boolean) => Promise<{ changed: boolean }>
}

export interface WeixinCredential {
  botToken: string
  botId?: string
  userId?: string
  baseUrl?: string
}

function extractText(message: Record<string, unknown>): string {
  const itemList = Array.isArray(message.item_list) ? message.item_list : []
  for (const item of itemList) {
    const record = item as Record<string, unknown>
    if (record.type !== 1)
      continue
    const textItem = (record.text_item ?? record) as Record<string, unknown>
    if (typeof textItem.text === 'string')
      return textItem.text
  }
  return ''
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface GetUpdatesResponse {
  ret?: number
  errcode?: number
  get_updates_buf?: string
  msgs?: Array<Record<string, unknown>>
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    timer.unref?.()
  })
}

/**
 * 个人微信没有卡片交互面，发送只走文本；context_token 从入站消息获取并缓存，
 * 每条回复都必须原样回传。重启后首次入站会重新建立 token，无需落盘。
 */
export function createWeixinTransport(credential: string, logger?: TransportLogger): WeixinTransport {
  const parsed = parseWeixinCredential(credential)
  const baseUrl = parsed.baseUrl || DEFAULT_API_BASE_URL
  const contextTokens = new Map<string, string>()
  const typingTickets = new Map<string, { ticket: string, expiresAt: number }>()
  const messageUsers = new Map<string, string>()
  const sendChunkRetries = readEnvInt('WEIXIN_SEND_CHUNK_RETRIES', 3)
  const sendChunkRetryDelayMs = readEnvInt('WEIXIN_SEND_CHUNK_RETRY_DELAY_MS', 1000)
  const textBatchDelayMs = readEnvInt('WEIXIN_TEXT_BATCH_DELAY_MS', 3000)
  const textBatchSplitDelayMs = readEnvInt('WEIXIN_TEXT_BATCH_SPLIT_DELAY_MS', 5000)
  let pollAbort: AbortController | undefined
  let pollPromise: Promise<void> | undefined
  let started = false
  let onInbound: ((event: unknown) => Promise<void>) | undefined
  const pendingTextBatches = new Map<string, {
    message: Record<string, unknown>
    text: string
    lastLength: number
    timer?: ReturnType<typeof setTimeout>
  }>()

  /**
   * iLink 会把转发/粘贴产生的连续消息拆成多条独立消息。文本消息
   * 按会话静默合并，等一段安静期再一次性交给 Agent，避免连续打断；
   * 非文本消息（图片等）不合并，立即回调。
   */
  function enqueueTextBatch(userId: string, message: Record<string, unknown>, text: string): void {
    const existing = pendingTextBatches.get(userId)
    if (existing) {
      existing.text = existing.text ? `${existing.text}\n${text}` : text
      existing.message = message
      existing.lastLength = text.length
    }
    else {
      pendingTextBatches.set(userId, { message, text, lastLength: text.length })
    }
    const entry = pendingTextBatches.get(userId)!
    if (entry.timer)
      clearTimeout(entry.timer)
    const waitMs = entry.lastLength >= TEXT_BATCH_SPLIT_THRESHOLD ? textBatchSplitDelayMs : textBatchDelayMs
    entry.timer = setTimeout(() => {
      void flushTextBatch(userId).catch((error) => {
        logger?.warn('[消息频道] 微信文本批处理失败', error instanceof Error ? error.message : String(error))
      })
    }, waitMs)
    entry.timer.unref?.()
  }

  async function flushTextBatch(userId: string): Promise<void> {
    const entry = pendingTextBatches.get(userId)
    if (!entry)
      return
    pendingTextBatches.delete(userId)
    // 合成一条消息：保留最新一条的身份/ID/context_token，文本为合并结果。
    const merged: Record<string, unknown> = { ...entry.message, item_list: [{ type: 1, text_item: { text: entry.text } }] }
    await onInbound?.(merged)
  }

  async function notify(suffix: 'start' | 'stop'): Promise<void> {
    try {
      await weixinPost({
        baseUrl,
        path: `ilink/bot/msg/notify${suffix}`,
        token: parsed.botToken,
        body: {},
        logger,
      })
    }
    catch (error) {
      logger?.warn(`[消息频道] 微信通知 ${suffix} 失败`, error instanceof Error ? error.message : String(error))
    }
  }

  async function pollLoop(signal: AbortSignal, onMessage: (event: unknown) => Promise<void>, onConnectionChange: (status: 'connected' | 'degraded', lastError?: string) => void): Promise<void> {
    let syncBuf = ''
    let consecutiveFailures = 0
    while (!signal.aborted) {
      try {
        const response = await weixinPost<GetUpdatesResponse>({
          baseUrl,
          path: 'ilink/bot/getupdates',
          token: parsed.botToken,
          body: { get_updates_buf: syncBuf },
          signal,
          timeoutMs: LONG_POLL_TIMEOUT_MS,
          logger,
        })
        logger?.debug('[消息频道] 微信长轮询返回', { msgs: response.msgs?.length ?? 0, ret: response.ret, errcode: response.errcode, hasCursor: Boolean(response.get_updates_buf) })
        if (response.errcode === SESSION_EXPIRED_ERRCODE || response.ret === SESSION_EXPIRED_ERRCODE) {
          consecutiveFailures = 0
          onConnectionChange('degraded', '微信会话已过期，请重新扫码登录')
          await sleep(BACKOFF_DELAY_MS, signal)
          continue
        }
        if ((response.ret !== undefined && response.ret !== 0) || (response.errcode !== undefined && response.errcode !== 0)) {
          consecutiveFailures += 1
          await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS, signal)
          continue
        }
        consecutiveFailures = 0
        onConnectionChange('connected')
        for (const message of response.msgs ?? []) {
          const userId = typeof message.from_user_id === 'string' ? message.from_user_id : ''
          const messageId = message.msg_id ?? message.message_id ?? message.seq
          if (userId && (typeof messageId === 'string' || typeof messageId === 'number'))
            messageUsers.set(String(messageId), userId)
          if (userId && typeof message.context_token === 'string')
            contextTokens.set(userId, message.context_token)
          const text = extractText(message)
          if (text && userId)
            enqueueTextBatch(userId, message, text)
          else
            await onMessage(message)
        }
        if (typeof response.get_updates_buf === 'string')
          syncBuf = response.get_updates_buf
      }
      catch (error) {
        if (signal.aborted)
          return
        consecutiveFailures += 1
        logger?.warn('[消息频道] 微信长轮询失败', error instanceof Error ? error.message : String(error))
        await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS, signal)
      }
    }
  }

  /**
   * sendmessage 共用发送路径：每条消息独立重试，同一消息复用 client_id
   * 便于 iLink 幂等；session 过期（-14）时去掉 context_token 降级重试一次。
   */
  async function sendIlinkMessage(input: {
    chatId: string
    contextToken: string
    itemList: Array<Record<string, unknown>>
  }): Promise<string> {
    const clientId = randomUUID()
    let effectiveToken: string | undefined = input.contextToken
    let retriedWithoutToken = false
    let lastError: Error | undefined
    for (let attempt = 0; attempt <= sendChunkRetries; attempt++) {
      try {
        const result = await weixinPost<{ message_id?: string, ret?: number, errcode?: number, errmsg?: string }>({
          baseUrl,
          path: 'ilink/bot/sendmessage',
          token: parsed.botToken,
          logger,
          body: {
            msg: {
              from_user_id: '',
              to_user_id: input.chatId,
              client_id: clientId,
              message_type: 2,
              message_state: 2,
              ...(effectiveToken ? { context_token: effectiveToken } : {}),
              item_list: input.itemList,
            },
          },
        })
        const ret = result.ret
        const errcode = result.errcode
        const failed = (ret !== undefined && ret !== 0) || (errcode !== undefined && errcode !== 0)
        if (failed) {
          const sessionExpired = ret === SESSION_EXPIRED_ERRCODE || errcode === SESSION_EXPIRED_ERRCODE || isStaleSession(ret, errcode, result.errmsg)
          if (sessionExpired && !retriedWithoutToken && effectiveToken) {
            retriedWithoutToken = true
            effectiveToken = undefined
            contextTokens.delete(input.chatId)
            logger?.warn('[消息频道] 微信会话过期，去掉 context_token 重试一次')
            continue
          }
          const rateLimited = ret === RATE_LIMIT_ERRCODE || errcode === RATE_LIMIT_ERRCODE
          lastError = new Error(`微信 iLink 发送失败：ret=${ret ?? '?'} errcode=${errcode ?? '?'} errmsg=${String(result.errmsg ?? '')}`)
          if (rateLimited && attempt < sendChunkRetries) {
            // 限流退避 3 倍，避免连续请求加剧触发频率限制。
            logger?.warn('[消息频道] 微信 iLink 限流，退避后重试')
            await delay(sendChunkRetryDelayMs * 3)
            continue
          }
          break
        }
        return result.message_id ?? clientId
      }
      catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt >= sendChunkRetries)
          break
        await delay(sendChunkRetryDelayMs * (attempt + 1))
      }
    }
    throw lastError ?? new Error('微信消息发送失败')
  }

  return {
    async start(handlers) {
      if (started)
        return
      started = true
      onInbound = handlers.onMessage
      pollAbort = new AbortController()
      await notify('start')
      pollPromise = pollLoop(pollAbort.signal, handlers.onMessage, handlers.onConnectionChange)
      handlers.onConnectionChange('connected')
    },
    async stop() {
      for (const entry of pendingTextBatches.values()) {
        if (entry.timer)
          clearTimeout(entry.timer)
      }
      pendingTextBatches.clear()
      pollAbort?.abort()
      await pollPromise?.catch(() => undefined)
      pollPromise = undefined
      pollAbort = undefined
      contextTokens.clear()
      typingTickets.clear()
      messageUsers.clear()
      if (started) {
        started = false
        await notify('stop')
      }
    },
    async sendText(chatId, text) {
      const contextToken = contextTokens.get(chatId)
      if (!contextToken)
        throw new Error('尚未收到该用户的微信消息，无法回复。')
      const messageId = await sendIlinkMessage({
        chatId,
        contextToken,
        itemList: [{ type: 1, text_item: { text } }],
      })
      return { messageId }
    },
    async sendFile(chatId, attachment) {
      const contextToken = contextTokens.get(chatId)
      if (!contextToken)
        throw new Error('尚未收到该用户的微信消息，无法发送附件。')
      const { mediaItem } = await uploadMediaToIlink({
        post: weixinPost,
        baseUrl,
        botToken: parsed.botToken,
        chatId,
        attachment,
        logger,
      })
      const messageId = await sendIlinkMessage({
        chatId,
        contextToken,
        itemList: [mediaItem],
      })
      return { messageId }
    },
    async setTyping(messageId, typing) {
      const userId = messageUsers.get(messageId)
      if (!userId)
        return { changed: false }
      const contextToken = contextTokens.get(userId)
      if (!contextToken)
        return { changed: false }
      // typing ticket 有 600 秒 TTL，过期后 sendtyping 静默失效，微信端
      // 会一直卡在"输入中"；超时后重新通过 getconfig 拉取。
      let cached = typingTickets.get(userId)
      if (!cached || cached.expiresAt <= Date.now()) {
        const config = await weixinPost<{ typing_ticket?: string }>({
          baseUrl,
          path: 'ilink/bot/getconfig',
          token: parsed.botToken,
          logger,
          body: { ilink_user_id: userId, context_token: contextToken },
        })
        if (!config.typing_ticket)
          return { changed: false }
        cached = { ticket: config.typing_ticket, expiresAt: Date.now() + TYPING_TICKET_TTL_MS }
        typingTickets.set(userId, cached)
      }
      await weixinPost({
        baseUrl,
        path: 'ilink/bot/sendtyping',
        token: parsed.botToken,
        logger,
        body: { ilink_user_id: userId, typing_ticket: cached.ticket, status: typing ? 1 : 2 },
      })
      return { changed: true }
    },
  }
}

export function parseWeixinCredential(value: string): WeixinCredential {
  try {
    const parsed = JSON.parse(value) as Partial<WeixinCredential>
    if (typeof parsed.botToken === 'string' && parsed.botToken) {
      return {
        botToken: parsed.botToken,
        botId: typeof parsed.botId === 'string' ? parsed.botId : undefined,
        userId: typeof parsed.userId === 'string' ? parsed.userId : undefined,
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
      }
    }
  }
  catch {
    // 统一转换为用户可理解的配置错误，不把凭证内容写入日志。
  }
  throw new Error('微信频道凭证格式无效')
}
