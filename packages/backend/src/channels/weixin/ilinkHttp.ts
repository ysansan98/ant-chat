import type { SystemLogger } from '../../systemLogger'
import { Buffer } from 'node:buffer'
import { createCipheriv, randomBytes } from 'node:crypto'
import process from 'node:process'
import { fetch } from 'undici'

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

export const DEFAULT_API_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
const DEFAULT_BOT_TYPE = '3'
export const LONG_POLL_TIMEOUT_MS = 35_000
export const QR_POLL_TIMEOUT_MS = 35_000
export const SESSION_EXPIRED_ERRCODE = -14
export const RATE_LIMIT_ERRCODE = -2
export const RETRY_DELAY_MS = 2_000
export const BACKOFF_DELAY_MS = 30_000
export const TYPING_TICKET_TTL_MS = 600_000
/** iLink 会把长文本拆成约 2048 字符的多条消息，达到阈值时放宽合并等待。 */
export const TEXT_BATCH_SPLIT_THRESHOLD = 1800
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
export function isStaleSession(ret: number | undefined, errcode: number | undefined, errmsg: unknown): boolean {
  if (ret !== RATE_LIMIT_ERRCODE && errcode !== RATE_LIMIT_ERRCODE)
    return false
  return String(errmsg ?? '').toLowerCase() === 'unknown error'
}

/** AES-128-ECB 加密并做 PKCS7 补位（Node crypto 默认填充）。 */
export function aes128EcbEncrypt(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

/** getuploadurl 的 filesize 是 PKCS7 补位后的大小，必须与密文长度一致。 */
export function aesPaddedSize(size: number): number {
  return Math.ceil(size / 16) * 16
}

/** 把密文 POST 到微信 CDN，响应头 x-encrypted-param 即最终 encrypt_query_param。 */
export async function weixinUploadCiphertext(input: {
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
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([item, entry]) => [item, describeValue(entry)]))
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
