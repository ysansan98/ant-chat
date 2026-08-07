import type { SystemLogger } from '../../systemLogger'
import { randomBytes, randomUUID } from 'node:crypto'
import { fetch } from 'undici'

export interface WeixinTransport {
  start: (handlers: {
    onMessage: (event: unknown) => Promise<void>
    onConnectionChange: (status: 'connected' | 'degraded', lastError?: string) => void
  }) => Promise<void>
  stop: () => Promise<void>
  sendText: (chatId: string, text: string) => Promise<{ messageId: string }>
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
const DEFAULT_BOT_TYPE = '3'
const LONG_POLL_TIMEOUT_MS = 35_000
const QR_POLL_TIMEOUT_MS = 35_000
const SESSION_EXPIRED_ERRCODE = -14
const RETRY_DELAY_MS = 2_000
const BACKOFF_DELAY_MS = 30_000
const BOT_AGENT = 'AntChat/1.0.0 (ant-chat)'
const ILINK_APP_ID = 'bot'
const ILINK_APP_CLIENT_VERSION = '1'

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
  const typingTickets = new Map<string, string>()
  const messageUsers = new Map<string, string>()
  let pollAbort: AbortController | undefined
  let pollPromise: Promise<void> | undefined
  let started = false

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

  return {
    async start(handlers) {
      if (started)
        return
      started = true
      pollAbort = new AbortController()
      await notify('start')
      pollPromise = pollLoop(pollAbort.signal, handlers.onMessage, handlers.onConnectionChange)
      handlers.onConnectionChange('connected')
    },
    async stop() {
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
      const clientId = randomUUID()
      const result = await weixinPost<{ message_id?: string }>({
        baseUrl,
        path: 'ilink/bot/sendmessage',
        token: parsed.botToken,
        logger,
        body: {
          msg: {
            from_user_id: '',
            to_user_id: chatId,
            client_id: clientId,
            message_type: 2,
            message_state: 2,
            context_token: contextToken,
            item_list: [{ type: 1, text_item: { text } }],
          },
        },
      })
      return { messageId: result.message_id ?? clientId }
    },
    async setTyping(messageId, typing) {
      const userId = messageUsers.get(messageId)
      if (!userId)
        return { changed: false }
      const contextToken = contextTokens.get(userId)
      if (!contextToken)
        return { changed: false }
      let ticket = typingTickets.get(userId)
      if (!ticket) {
        const config = await weixinPost<{ typing_ticket?: string }>({
          baseUrl,
          path: 'ilink/bot/getconfig',
          token: parsed.botToken,
          logger,
          body: { ilink_user_id: userId, context_token: contextToken },
        })
        ticket = config.typing_ticket
        if (!ticket)
          return { changed: false }
        typingTickets.set(userId, ticket)
      }
      await weixinPost({
        baseUrl,
        path: 'ilink/bot/sendtyping',
        token: parsed.botToken,
        logger,
        body: { ilink_user_id: userId, typing_ticket: ticket, status: typing ? 1 : 2 },
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
