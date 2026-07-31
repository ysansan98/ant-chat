import { afterEach, describe, expect, it, vi } from 'vitest'
import { startOAuthCallbackServer } from '../oauthCallbackServer'

describe('oauth callback server', () => {
  const servers: Array<{ dispose: () => Promise<void> }> = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.dispose()))
  })

  it('runtime 未登记 callback handler 时拒绝回调，不会错误消费授权结果', async () => {
    const server = await startOAuthCallbackServer(vi.fn(async () => {}))
    servers.push(server)

    const response = await fetch(`${server.host.redirectUrl}?code=code&state=state`)

    expect(response.status).toBe(503)
    await expect(response.text()).resolves.toContain('应用尚未就绪')
  })

  it('将完整 callback 参数交给 Runtime 登记的唯一 handler', async () => {
    let received: URLSearchParams | undefined
    const server = await startOAuthCallbackServer(vi.fn(async () => {}))
    servers.push(server)
    server.host.setCallbackHandler(async (params) => {
      received = new URLSearchParams(params)
    })

    const response = await fetch(`${server.host.redirectUrl}?code=code&state=state&error_description=none`)

    expect(response.status).toBe(200)
    expect(received).toBeInstanceOf(URLSearchParams)
    expect(received?.toString()).toBe('code=code&state=state&error_description=none')
  })
})
