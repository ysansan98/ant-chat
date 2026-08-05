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

  it('将完整 callback 参数交给订阅者', async () => {
    let received: URLSearchParams | undefined
    const server = await startOAuthCallbackServer(vi.fn(async () => {}))
    servers.push(server)
    server.host.subscribeCallback(async (params) => {
      received = new URLSearchParams(params)
    })

    const response = await fetch(`${server.host.redirectUrl}?code=code&state=state&error_description=none`)

    expect(response.status).toBe(200)
    expect(received).toBeInstanceOf(URLSearchParams)
    expect(received?.toString()).toBe('code=code&state=state&error_description=none')
  })

  it('多个 owner 可独立订阅，未命中继续分发，释放一个不影响另一个', async () => {
    const server = await startOAuthCallbackServer(vi.fn(async () => {}))
    servers.push(server)
    const first = vi.fn(async () => false)
    const second = vi.fn(async () => true)
    const disposeFirst = server.host.subscribeCallback(first)
    const disposeSecond = server.host.subscribeCallback(second)

    await expect(fetch(`${server.host.redirectUrl}?state=state`)).resolves.toMatchObject({ status: 200 })
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()

    disposeFirst()
    disposeFirst()
    await expect(fetch(`${server.host.redirectUrl}?state=state-2`)).resolves.toMatchObject({ status: 200 })
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledTimes(2)

    disposeSecond()
    await expect(fetch(`${server.host.redirectUrl}?state=state-3`)).resolves.toMatchObject({ status: 503 })
  })

  it('codex 订阅解析到 OpenAI 注册的固定端口专用回调地址并完成分发', async () => {
    const server = await startOAuthCallbackServer(vi.fn(async () => {}))
    servers.push(server)
    const received: URLSearchParams[] = []
    server.host.subscribeCallback(async (params) => {
      received.push(new URLSearchParams(params))
      return true
    })

    const codexUrl = await server.host.resolveOAuthRedirectUrl?.('codex-subscription')
    expect(codexUrl).toBeDefined()
    const parsed = new URL(codexUrl!)
    // OpenAI 的 Codex OAuth client 只注册 1455 / 1457 两个回调端口和 /auth/callback 路径。
    expect(parsed.pathname).toBe('/auth/callback')
    expect([1455, 1457]).toContain(Number(parsed.port))

    const response = await fetch(`${codexUrl}?code=code&state=state`)
    expect(response.status).toBe(200)
    expect(received).toHaveLength(1)
    expect(received[0].toString()).toBe('code=code&state=state')
  })

  it('非 codex 集成解析到通用回调地址', async () => {
    const server = await startOAuthCallbackServer(vi.fn(async () => {}))
    servers.push(server)

    const url = await server.host.resolveOAuthRedirectUrl?.('other-integration')
    expect(url).toBe(server.host.redirectUrl)
  })
})
