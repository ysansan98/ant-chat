import type { ChannelSetupMode } from '@ant-chat/shared'
import { randomUUID } from 'node:crypto'
import * as lark from '@larksuiteoapi/node-sdk'

export interface FeishuSetupState {
  setupId: string
  mode: ChannelSetupMode
  status: 'awaiting_scan' | 'polling' | 'completed' | 'failed' | 'expired'
  verificationUrl?: string
  expiresAt?: number
  error?: string
}

/** 管理飞书应用扫码注册流程，凭证持久化仍由 ChannelModule 负责。 */
export class FeishuAppRegistration {
  private readonly states = new Map<string, FeishuSetupState>()
  private readonly controllers = new Map<string, AbortController>()

  start(input: {
    appName: string
    /** 传入已有应用 ID（cli_xxx）时走重新授权流程：确认页展示 addons 变更 diff，用户扫码后更新该应用配置。 */
    appId?: string
    onCompleted: (result: { clientId: string, clientSecret: string }) => Promise<void>
  }): FeishuSetupState {
    const setupId = randomUUID()
    const state: FeishuSetupState = { setupId, mode: input.appId ? 'reauth' : 'create', status: 'awaiting_scan' }
    this.states.set(setupId, state)
    const controller = new AbortController()
    this.controllers.set(setupId, controller)
    void lark.registerApp({
      signal: controller.signal,
      // 创建新应用时锁定 createOnly，防止误绑已有应用覆盖其配置；重新授权时移除该限制并把 appId 带给确认页。
      createOnly: input.appId ? undefined : true,
      appId: input.appId,
      source: 'ant-chat',
      appPreset: { name: input.appName, desc: 'Ant Chat 消息频道' },
      addons: {
        scopes: {
          tenant: ['im:message:send_as_bot', 'im:message:update', 'im:message.reactions:write_only'],
        },
        events: {
          items: { tenant: ['im.message.receive_v1'] },
        },
        callbacks: {
          items: ['card.action.trigger'],
        },
      },
      onQRCodeReady: (qr) => {
        this.update(setupId, { status: 'awaiting_scan', verificationUrl: qr.url, expiresAt: Date.now() + qr.expireIn * 1000 })
      },
      onStatusChange: next => this.update(setupId, { status: next.status === 'polling' ? 'polling' : 'awaiting_scan' }),
    }).then(async (result) => {
      await input.onCompleted({ clientId: result.client_id, clientSecret: result.client_secret })
      this.update(setupId, { status: 'completed' })
      this.controllers.delete(setupId)
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      this.update(setupId, { status: message.includes('expired') ? 'expired' : 'failed', error: message })
      this.controllers.delete(setupId)
    })
    return state
  }

  get(setupId: string): FeishuSetupState | undefined {
    return this.states.get(setupId)
  }

  cancel(setupId: string): void {
    this.controllers.get(setupId)?.abort()
    this.controllers.delete(setupId)
    this.states.delete(setupId)
  }

  private update(setupId: string, patch: Partial<FeishuSetupState>): void {
    const current = this.states.get(setupId)
    if (current)
      this.states.set(setupId, { ...current, ...patch })
  }
}
