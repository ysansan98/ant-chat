import { describe, expect, it, vi } from 'vitest'
import { FeishuAppRegistration } from '../appRegistration'

const registerApp = vi.hoisted(() => vi.fn())

vi.mock('@larksuiteoapi/node-sdk', () => ({ registerApp }))

describe('飞书应用扫码配置', () => {
  it('申请发送、更新卡片、typing 和卡片回调所需能力', async () => {
    registerApp.mockImplementation(async (options) => {
      options.onQRCodeReady({ url: 'https://example.com/qr', expireIn: 600 })
      return { client_id: 'cli_x', client_secret: 'secret' }
    })
    const onCompleted = vi.fn(async () => {})

    new FeishuAppRegistration().start({ appName: 'Ant Chat', onCompleted })

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce())
    expect(registerApp).toHaveBeenCalledWith(expect.objectContaining({
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
})
