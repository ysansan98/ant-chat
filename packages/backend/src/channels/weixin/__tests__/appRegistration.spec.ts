import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WeixinAppRegistration } from '../appRegistration'

const mocks = vi.hoisted(() => ({
  getWeixinBotQrcode: vi.fn(),
  getWeixinQrStatus: vi.fn(),
}))

vi.mock('../transport', () => ({
  getWeixinBotQrcode: mocks.getWeixinBotQrcode,
  getWeixinQrStatus: mocks.getWeixinQrStatus,
}))

describe('微信扫码注册流程', () => {
  beforeEach(() => {
    mocks.getWeixinBotQrcode.mockReset()
    mocks.getWeixinQrStatus.mockReset()
  })

  it('扫码确认后返回 bot 凭证并标记完成', async () => {
    mocks.getWeixinBotQrcode.mockResolvedValue({ qrcode: 'qr-1', qrcode_img_content: 'https://qr.example/img' })
    mocks.getWeixinQrStatus.mockResolvedValue({ status: 'confirmed', bot_token: 'token-1', ilink_endpoint_id: 'bot-1', ilink_user_id: 'owner-1', baseurl: 'https://ilink.redirect' })
    const registration = new WeixinAppRegistration()
    const onCompleted = vi.fn()
    const state = registration.start({ onCompleted })

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ botToken: 'token-1', userId: 'owner-1' })))
    expect(registration.get(state.setupId)).toEqual(expect.objectContaining({ status: 'completed', verificationUrl: 'https://qr.example/img' }))
  })

  it('本地 token 存在时以 reauth 模式发起并带回服务端', async () => {
    mocks.getWeixinBotQrcode.mockResolvedValue({ qrcode: 'qr-2', qrcode_img_content: 'https://qr.example/img' })
    mocks.getWeixinQrStatus.mockResolvedValue({ status: 'binded_redirect' })
    const registration = new WeixinAppRegistration()
    const state = registration.start({ localToken: 'token-old', onCompleted: vi.fn() })

    expect(state.mode).toBe('reauth')
    await vi.waitFor(() => expect(mocks.getWeixinBotQrcode).toHaveBeenCalledWith(expect.objectContaining({ localTokenList: ['token-old'] })))
  })

  it('need_verifycode 后提交验证码继续轮询', async () => {
    mocks.getWeixinBotQrcode.mockResolvedValue({ qrcode: 'qr-3', qrcode_img_content: 'https://qr.example/img' })
    mocks.getWeixinQrStatus
      .mockResolvedValueOnce({ status: 'need_verifycode' })
      .mockResolvedValueOnce({ status: 'confirmed', bot_token: 'token-3', ilink_user_id: 'owner-3' })
    const registration = new WeixinAppRegistration()
    const onCompleted = vi.fn()
    const state = registration.start({ onCompleted })

    await vi.waitFor(() => expect(registration.get(state.setupId)).toEqual(expect.objectContaining({ verifyCodeRequired: true })))
    registration.get(state.setupId, '1234')
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ botToken: 'token-3' })))
    expect(registration.get(state.setupId)).toEqual(expect.objectContaining({ status: 'completed', verifyCodeRequired: false }))
  })

  it('二维码过期时标记 expired', async () => {
    mocks.getWeixinBotQrcode.mockResolvedValue({ qrcode: 'qr-4', qrcode_img_content: 'https://qr.example/img' })
    mocks.getWeixinQrStatus.mockResolvedValue({ status: 'expired' })
    const registration = new WeixinAppRegistration()
    const state = registration.start({ onCompleted: vi.fn() })

    await vi.waitFor(() => expect(registration.get(state.setupId)).toEqual(expect.objectContaining({ status: 'expired' })))
  })
})
