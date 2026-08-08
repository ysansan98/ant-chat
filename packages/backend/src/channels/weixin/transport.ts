import type { SystemLogger } from '../../systemLogger'
import type { ChannelAttachment } from '../channelConnector'
import { Buffer } from 'node:buffer'
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import process from 'node:process'
import { fetch } from 'undici'

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

export interface WeixinQrCodeResponse {
  qrcode: string
  qrcode_img_content?: string
  ret?: number
}

export interface WeixinQrStatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect' | 'binded_redirect' | 'need_verifycode' | 'verify_code_blocked' | string
  ret?: number
  timedOut?: boolean
  bot_token?: string
  ilink_endpoint_id?: string
  ilink_user_id?: string
  baseurl?: string
  redirect_host?: string
}

export type TransportLogger = Pick<SystemLogger, 'debug' | 'info' | 'warn' | 'error'>

const DEFAULT_API_BASE_URL = 'https://ilinkai.weixin.qq.com'
const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
const DEFAULT_BOT_TYPE = '3'
const LONG_POLL_TIMEOUT_MS = 35_000
const QR_POLL_TIMEOUT_MS = 35_000
const SESSION_EXPIRED_ERRCODE = -14
const RATE_LIMIT_ERRCODE = -2
const RETRY_DELAY_MS = 2_000
const BACKOFF_DELAY_MS = 30_000
const TYPING_TICKET_TTL_MS = 600_000
/** iLink 会把长文本拆成约 2048 字符的多条消息，达到阈值时放宽合并等待。 */
const TEXT_BATCH_SPLIT_THRESHOLD = 1800
const BOT_AGENT = 'AntChat/1.0.0 (ant-chat)'
const ILINK_APP_ID = 'bot'
const ILINK_APP_CLIENT_VERSION = '1'

/** 读取环境变量整数配置，缺失或非法时回退默认值。 */
export function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw)
    return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** iLink 的 ret=-2/errcode=-2 + "unknown error" 是会话过期信号，不是真限流。 */
function isStaleSession(ret: number | undefined, errcode: number | undefined, errmsg: unknown): boolean {
  if (ret !== RATE_LIMIT_ERRCODE && errcode !== RATE_LIMIT_ERRCODE)
    return false
  return String(errmsg ?? '').toLowerCase() === 'unknown error'
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

/** AES-128-ECB 加密并做 PKCS7 补位（Node crypto 默认填充）。 */
function aes128EcbEncrypt(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

/** getuploadurl 的 filesize 是 PKCS7 补位后的大小，必须与密文长度一致。 */
function aesPaddedSize(size: number): number {
  return Math.ceil(size / 16) * 16
}

/** 把密文 POST 到微信 CDN，响应头 x-encrypted-param 即最终 encrypt_query_param。 */
async function weixinUploadCiphertext(input: {
  uploadUrl: string
  ciphertext: Buffer
  signal?: AbortSignal
  timeoutMs?: number
  logger?: TransportLogger
}): Promise<string> {
  input.logger?.debug('[消息频道] 微信 CDN 上传', { timeoutMs: input.timeoutMs })
  try {
    const response = await fetch(input.uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: input.ciphertext,
      signal: timeoutSignal(input.signal ?? new AbortController().signal, input.timeoutMs ?? 120_000),
    })
    const encryptedParam = response.headers.get('x-encrypted-param')
    const raw = await response.text()
    if (!response.ok)
      throw new Error(`微信 CDN 上传失败：HTTP ${response.status} ${raw.slice(0, 200)}`)
    if (!encryptedParam)
      throw new Error(`微信 CDN 上传缺少 x-encrypted-param 响应头：${raw.slice(0, 200)}`)
    return encryptedParam
  }
  catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError' && !input.signal?.aborted) {
      input.logger?.debug('[消息频道] 微信 CDN 上传超时', {})
      throw new Error('微信 CDN 上传超时')
    }
    input.logger?.warn('[消息频道] 微信 CDN 上传异常', { error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

/** 微信 iLink 的 base_info 随每个授权请求携带，标识驱动 bot 的客户端。 */
function buildBaseInfo(): { channel_version: string, bot_agent: string } {
  return { channel_version: '1', bot_agent: BOT_AGENT }
}

function commonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': ILINK_APP_CLIENT_VERSION,
  }
}

function postHeaders(token?: string): Record<string, string> {
  return {
    ...commonHeaders(),
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomBytes(4).toString('base64'),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function timeoutSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

/** 脱敏请求 body：只保留字段名与类型，绝不输出 bot token、context token、验证码或同步游标。 */
function redactBody(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, describeValue(value)]),
  )
}

function describeValue(value: unknown): unknown {
  if (value === null || value === undefined)
    return value
  if (typeof value === 'string')
    return typeof value === 'string' && value.length ? '[string]' : '[empty string]'
  if (typeof value === 'number' || typeof value === 'boolean')
    return value
  if (Array.isArray(value))
    return value.map(item => describeValue(item))
  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, describeValue(item)]))
  return typeof value
}

/** 脱敏响应：bot_token/context_token/get_updates_buf/qrcode 等敏感字段只保留存在性，其余完整保留。 */
function redactResponse(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const redacted = { ...parsed }
    for (const key of ['bot_token', 'context_token', 'get_updates_buf', 'sync_buf', 'qrcode', 'verify_code', 'typing_ticket']) {
      if (key in redacted)
        redacted[key] = `[${typeof redacted[key]} present]`
    }
    if (redacted.msg && typeof redacted.msg === 'object')
      redacted.msg = describeValue(redacted.msg)
    if (Array.isArray(redacted.msgs)) {
      redacted.msgs = redacted.msgs.map((item) => {
        const record = item as Record<string, unknown>
        const out: Record<string, unknown> = { ...record }
        if ('context_token' in out)
          out.context_token = '[string present]'
        if ('item_list' in out)
          out.item_list = describeValue(out.item_list)
        return out
      })
    }
    return redacted
  }
  catch {
    return raw.slice(0, 200)
  }
}

export async function weixinPost<T>(input: {
  baseUrl: string
  path: string
  token?: string
  body: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
  logger?: TransportLogger
}): Promise<T> {
  const requestBody = JSON.stringify({ ...input.body, base_info: buildBaseInfo() })
  input.logger?.debug('[消息频道] 微信 POST', {
    path: input.path,
    timeoutMs: input.timeoutMs,
    body: redactBody(input.body),
  })
  try {
    const response = await fetch(new URL(input.path, input.baseUrl), {
      method: 'POST',
      headers: postHeaders(input.token),
      body: requestBody,
      signal: timeoutSignal(input.signal ?? new AbortController().signal, input.timeoutMs ?? 30_000),
    })
    const rawText = await response.text()
    input.logger?.info('[消息频道] 微信 POST 响应', {
      path: input.path,
      httpStatus: response.status,
      response: redactResponse(rawText),
    })
    if (!response.ok)
      throw new Error(`微信 iLink 请求失败：HTTP ${response.status} ${rawText.slice(0, 200)}`)
    return JSON.parse(rawText) as T
  }
  catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError' && !input.signal?.aborted) {
      input.logger?.debug('[消息频道] 微信 POST 超时', { path: input.path })
      return { ret: 0 } as T
    }
    input.logger?.warn('[消息频道] 微信 POST 异常', { path: input.path, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export async function weixinGet<T>(input: {
  baseUrl: string
  path: string
  token?: string
  signal?: AbortSignal
  timeoutMs?: number
  logger?: TransportLogger
}): Promise<T> {
  input.logger?.debug('[消息频道] 微信 GET', { path: input.path, timeoutMs: input.timeoutMs })
  try {
    const response = await fetch(new URL(input.path, input.baseUrl), {
      method: 'GET',
      headers: commonHeaders(),
      signal: timeoutSignal(input.signal ?? new AbortController().signal, input.timeoutMs ?? 30_000),
    })
    const rawText = await response.text()
    input.logger?.info('[消息频道] 微信 GET 响应', {
      path: input.path,
      httpStatus: response.status,
      response: redactResponse(rawText),
    })
    if (!response.ok)
      throw new Error(`微信 iLink 请求失败：HTTP ${response.status} ${rawText.slice(0, 200)}`)
    return JSON.parse(rawText) as T
  }
  catch (error) {
    // 长轮询接口超时是正常状态：上层应继续轮询而不是把登录判死。
    if (error instanceof Error && error.name === 'TimeoutError' && !input.signal?.aborted) {
      input.logger?.debug('[消息频道] 微信 GET 超时，继续轮询', { path: input.path })
      return { ret: 0, timedOut: true } as T
    }
    input.logger?.warn('[消息频道] 微信 GET 异常', { path: input.path, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export function getWeixinBotQrcode(input: {
  baseUrl?: string
  localTokenList?: string[]
  signal?: AbortSignal
  logger?: TransportLogger
}): Promise<WeixinQrCodeResponse> {
  return weixinPost<WeixinQrCodeResponse>({
    baseUrl: input.baseUrl ?? DEFAULT_API_BASE_URL,
    path: `ilink/bot/get_bot_qrcode?bot_type=${DEFAULT_BOT_TYPE}`,
    body: { local_token_list: input.localTokenList ?? [] },
    signal: input.signal,
    logger: input.logger,
  })
}

export function getWeixinQrStatus(input: {
  baseUrl: string
  qrcode: string
  verifyCode?: string
  signal?: AbortSignal
  logger?: TransportLogger
}): Promise<WeixinQrStatusResponse> {
  const query = new URLSearchParams({ qrcode: input.qrcode })
  if (input.verifyCode)
    query.set('verify_code', input.verifyCode)
  return weixinGet<WeixinQrStatusResponse>({
    baseUrl: input.baseUrl,
    path: `ilink/bot/get_qrcode_status?${query.toString()}`,
    signal: input.signal,
    timeoutMs: QR_POLL_TIMEOUT_MS,
    logger: input.logger,
  })
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
      const plaintext = Buffer.from(attachment.data, 'base64')
      const filekey = randomBytes(16).toString('hex')
      const aesKey = randomBytes(16)
      const rawfilemd5 = createHash('md5').update(plaintext).digest('hex')
      // media_type：1=图片，2=视频，3=文件，4=语音。视频/语音原生气泡未验证，
      // document/file 一律按文件（3）发送，与 Hermes 参考实现一致。
      const mediaType = attachment.kind === 'image' ? 1 : 3
      const uploadResponse = await weixinPost<{
        upload_full_url?: string
        upload_param?: string
        ret?: number
        errcode?: number
        errmsg?: string
      }>({
        baseUrl,
        path: 'ilink/bot/getuploadurl',
        token: parsed.botToken,
        logger,
        body: {
          filekey,
          media_type: mediaType,
          to_user_id: chatId,
          rawsize: plaintext.byteLength,
          rawfilemd5,
          filesize: aesPaddedSize(plaintext.byteLength),
          no_need_thumb: true,
          aeskey: aesKey.toString('hex'),
        },
      })
      const uploadUrl = uploadResponse.upload_full_url
        ?? (uploadResponse.upload_param
          ? `${process.env.WEIXIN_CDN_BASE_URL ?? DEFAULT_CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadResponse.upload_param)}&filekey=${encodeURIComponent(filekey)}`
          : undefined)
      if (!uploadUrl)
        throw new Error('微信 getuploadurl 未返回 upload_full_url 或 upload_param')
      const ciphertext = aes128EcbEncrypt(plaintext, aesKey)
      const encryptQueryParam = await weixinUploadCiphertext({
        uploadUrl,
        ciphertext,
        logger,
      })
      // iLink 期望 aes_key 为 base64(hex(key)) 而不是 base64(原始字节)，
      // 否则接收端无法解密，图片显示灰块。
      const aesKeyForApi = Buffer.from(aesKey.toString('hex')).toString('base64')
      const mediaItem = attachment.kind === 'image'
        ? {
            type: 2,
            image_item: {
              media: { encrypt_query_param: encryptQueryParam, aes_key: aesKeyForApi, encrypt_type: 1 },
              mid_size: ciphertext.byteLength,
            },
          }
        : {
            type: 4,
            file_item: {
              media: { encrypt_query_param: encryptQueryParam, aes_key: aesKeyForApi, encrypt_type: 1 },
              file_name: attachment.name,
              len: String(plaintext.byteLength),
            },
          }
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
