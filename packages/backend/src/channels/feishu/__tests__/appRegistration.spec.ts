import { describe, expect, it, vi } from 'vitest'
import { FeishuAppRegistration } from '../appRegistration'

const registerApp = vi.hoisted(() => vi.fn())

vi.mock('@larksuiteoapi/node-sdk', () => ({ registerApp }))

describe('飞书应用扫码配置', () => {
  it('申请发送、更新卡片、typing 和卡片回调所需能力，且创建模式锁定 createOnly', async () => {
    registerApp.mockImplementation(async (options) => {
      options.onQRCodeReady({ url: 'https://example.com/qr', expireIn: 600 })
      return { client_id: 'cli_x', client_secret: 'secret' }
    })
    const onCompleted = vi.fn(async () => {})

    new FeishuAppRegistration().start({ appName: 'Ant Chat', onCompleted })

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce())
    expect(registerApp).toHaveBeenCalledWith(expect.objectContaining({
      createOnly: true,
      addons: {
        scopes: {
          tenant: ['im:message:send_as_bot', 'im:message:update', 'im:message.reactions:write_only'],
        },
        events: {
          items: {
            tenant: ['im.message.receive_v1'],
          },
        },
        callbacks: {
          items: ['card.action.trigger'],
        },
      },
    }))
  })

  it('传入已有 appId 时走重新授权流程：不锁 createOnly，把 appId 带给确认页', async () => {
    registerApp.mockImplementation(async (options) => {
      options.onQRCodeReady({ url: 'https://example.com/qr', expireIn: 600 })
      return { client_id: 'cli_existing', client_secret: 'secret' }
    })
    const onCompleted = vi.fn(async () => {})

    const state = new FeishuAppRegistration().start({ appName: 'Ant Chat', appId: 'cli_existing', onCompleted })

    expect(state.mode).toBe('reauth')
    expect(registerApp).toHaveBeenCalledWith(expect.not.objectContaining({ createOnly: true }))
    expect(registerApp).toHaveBeenCalledWith(expect.objectContaining({ appId: 'cli_existing' }))
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce())
    expect(onCompleted).toHaveBeenCalledWith({ clientId: 'cli_existing', clientSecret: 'secret' })
  })

  it('创建模式返回 mode 为 create', () => {
    registerApp.mockImplementation(async () => ({ client_id: 'cli_x', client_secret: 'secret' }))
    const state = new FeishuAppRegistration().start({ appName: 'Ant Chat', onCompleted: vi.fn(async () => {}) })
    expect(state.mode).toBe('create')
  })
})
