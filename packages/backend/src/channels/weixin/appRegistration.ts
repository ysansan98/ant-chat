import type { ChannelSetupMode } from '@ant-chat/shared'
import type { SystemLogger } from '../../systemLogger'
import type { WeixinCredential } from './transport'
import { randomUUID } from 'node:crypto'
import { getWeixinBotQrcode, getWeixinQrStatus } from './transport'

export interface WeixinSetupState {
  setupId: string
  mode: ChannelSetupMode
  status: 'awaiting_scan' | 'polling' | 'completed' | 'failed' | 'expired'
  verificationUrl?: string
  expiresAt?: number
  error?: string
  verifyCodeRequired?: boolean
  /** 已提交的验证码；提交后由轮询循环消费。 */
  verifyCode?: string
}

type SetupLogger = Pick<SystemLogger, 'debug' | 'info' | 'warn' | 'error'>

const QR_LOGIN_TIMEOUT_MS = 480_000
const QR_POLL_INTERVAL_MS = 3_000

/** 管理微信 iLink 扫码登录流程，凭证持久化仍由 ChannelModule 负责。 */
export class WeixinAppRegistration {
  private readonly states = new Map<string, WeixinSetupState>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly codeWaiters = new Map<string, (code: string) => void>()
  /** 已提交但尚未被轮询消费的验证码；轮询到 need_verifycode 时优先复用。 */
  private readonly pendingCodes = new Map<string, string>()
  constructor(private readonly logger?: SetupLogger) {}

  start(input: {
    /** 已有 bot token 时带回服务端，已绑定的账号可直接确认而不用重复授权。 */
    localToken?: string
    onCompleted: (credential: WeixinCredential) => Promise<void>
  }): WeixinSetupState {
    const setupId = randomUUID()
    // 仅用于标记 reauth 模式；扫码请求本身不带旧 token，避免服务端一直走 binded_redirect。
    const state: WeixinSetupState = { setupId, mode: input.localToken ? 'reauth' : 'create', status: 'awaiting_scan' }
    this.states.set(setupId, state)
    const controller = new AbortController()
    this.controllers.set(setupId, controller)
    this.logger?.info('[消息频道] 微信扫码会话已创建', { setupId, mode: state.mode, hasLocalToken: Boolean(input.localToken) })
    void this.run(setupId, input.localToken, input.onCompleted, controller.signal)
    return state
  }

  get(setupId: string, verifyCode?: string): WeixinSetupState | undefined {
    const state = this.states.get(setupId)
    if (!state)
      return undefined
    if (verifyCode && state.verifyCodeRequired) {
      state.verifyCode = verifyCode
      const waiter = this.codeWaiters.get(setupId)
      if (waiter) {
        this.codeWaiters.delete(setupId)
        waiter(verifyCode)
      }
      else {
        this.pendingCodes.set(setupId, verifyCode)
      }
    }
    return state
  }

  cancel(setupId: string): void {
    this.controllers.get(setupId)?.abort()
    this.controllers.delete(setupId)
    this.states.delete(setupId)
    this.codeWaiters.delete(setupId)
    this.pendingCodes.delete(setupId)
  }

  private async run(setupId: string, localToken: string | undefined, onCompleted: (credential: WeixinCredential) => Promise<void>, signal: AbortSignal): Promise<void> {
    try {
      const qr = await getWeixinBotQrcode({
        // 不把旧 token 带给服务端：扫码流程保持 create 语义，拿到新 token 后再替换。
        localTokenList: [],
        signal,
        logger: this.logger,
      })
      const state = this.states.get(setupId)
      if (!state)
        return
      // qrcode_img_content 是可直接展示的图片 URL；qrcode 只是登录 token，不能当图片地址。
      if (!qr.qrcode_img_content)
        throw new Error('微信未返回可展示的二维码图片，请稍后重试')
      state.verificationUrl = qr.qrcode_img_content
      state.expiresAt = Date.now() + QR_LOGIN_TIMEOUT_MS
      this.logger?.info('[消息频道] 微信二维码已获取', { setupId, expiresAt: state.expiresAt })
      const credential = await this.pollLogin(setupId, qr.qrcode, localToken, signal)
      await onCompleted(credential)
      this.update(setupId, { status: 'completed' })
      this.controllers.delete(setupId)
      this.logger?.info('[消息频道] 微信扫码登录完成', { setupId })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.update(setupId, {
        status: message.includes('过期') ? 'expired' : 'failed',
        error: message,
      })
      this.controllers.delete(setupId)
      this.logger?.warn('[消息频道] 微信扫码登录失败', { setupId, status: this.states.get(setupId)?.status, error: message })
    }
  }

  private async pollLogin(setupId: string, qrcode: string, localToken: string | undefined, signal: AbortSignal): Promise<WeixinCredential> {
    const deadline = Date.now() + QR_LOGIN_TIMEOUT_MS
    let baseUrl = 'https://ilinkai.weixin.qq.com'
    let verifyCode: string | undefined
    while (Date.now() < deadline) {
      if (signal.aborted)
        throw new Error('扫码登录已取消')
      const pending = this.pendingCodes.get(setupId)
      if (pending) {
        this.pendingCodes.delete(setupId)
        verifyCode = pending
      }
      const status = await getWeixinQrStatus({ baseUrl, qrcode, verifyCode, signal, logger: this.logger })
      if (status.timedOut)
        continue
      this.logger?.info('[消息频道] 微信扫码状态轮询', {
        setupId,
        status: status.status,
        ret: status.ret,
        responseKeys: Object.keys(status).sort(),
        hasBotToken: Boolean(status.bot_token),
        hasUserId: Boolean(status.ilink_user_id),
        hasRedirect: Boolean(status.redirect_host),
      })
      if (status.status === 'scaned_but_redirect' && status.redirect_host) {
        baseUrl = status.redirect_host.startsWith('http') ? status.redirect_host : `https://${status.redirect_host}`
        this.logger?.info('[消息频道] 微信扫码切换轮询地址', { setupId, redirectHost: status.redirect_host })
        continue
      }
      if (status.status === 'confirmed' || status.status === 'binded_redirect') {
        const botToken = status.bot_token ?? (status.status === 'binded_redirect' ? localToken : undefined)
        if (!botToken)
          throw new Error(status.status === 'binded_redirect' ? '扫码成功但本地没有可复用的 bot token' : '扫码成功但未返回 bot_token')
        return {
          botToken,
          botId: status.ilink_endpoint_id,
          userId: status.ilink_user_id,
          baseUrl: status.baseurl ?? baseUrl,
        }
      }
      if (status.status === 'need_verifycode') {
        this.update(setupId, {
          status: 'awaiting_scan',
          verifyCodeRequired: true,
          error: '请在手机上确认验证码后输入',
        })
        verifyCode = await this.waitForVerifyCode(setupId, signal)
        this.update(setupId, { verifyCodeRequired: false })
        continue
      }
      if (status.status === 'expired') {
        throw new Error('二维码已过期，请重新发起扫码')
      }
      this.update(setupId, {
        status: status.status === 'scaned' ? 'polling' : 'awaiting_scan',
        verifyCodeRequired: false,
      })
      await sleepWithAbort(QR_POLL_INTERVAL_MS, signal)
    }
    throw new Error('微信扫码登录超时')
  }

  private waitForVerifyCode(setupId: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        this.codeWaiters.delete(setupId)
        reject(new Error('扫码登录已取消'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.codeWaiters.set(setupId, (code) => {
        signal.removeEventListener('abort', onAbort)
        resolve(code)
      })
    })
  }

  private update(setupId: string, patch: Partial<WeixinSetupState>): void {
    const current = this.states.get(setupId)
    if (current)
      this.states.set(setupId, { ...current, ...patch })
  }
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('扫码登录已取消'))
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      if (timer)
        clearTimeout(timer)
      reject(new Error('扫码登录已取消'))
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
