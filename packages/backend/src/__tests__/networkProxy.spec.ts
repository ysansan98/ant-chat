import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const initialDispatcher = { close: vi.fn() }
  return {
    agentClose: vi.fn(async () => {}),
    fetch: vi.fn(async () => ({ ok: true })),
    getGlobalDispatcher: vi.fn(() => initialDispatcher),
    initialDispatcher,
    setGlobalDispatcher: vi.fn(),
  }
})

vi.mock('undici', () => ({
  Agent: vi.fn(class Agent {
    close = mocks.agentClose
  }),
  EnvHttpProxyAgent: vi.fn(class EnvHttpProxyAgent {
    close = mocks.agentClose

    constructor(readonly options?: unknown) {}
  }),
  fetch: mocks.fetch,
  getGlobalDispatcher: mocks.getGlobalDispatcher,
  setGlobalDispatcher: mocks.setGlobalDispatcher,
}))

const originalEnvironment = {
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NO_PROXY: process.env.NO_PROXY,
  http_proxy: process.env.http_proxy,
  https_proxy: process.env.https_proxy,
  no_proxy: process.env.no_proxy,
}

describe('网络代理管理器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearProxyEnvironment()
  })

  afterEach(() => {
    clearProxyEnvironment()
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value !== undefined)
        process.env[key] = value
    }
  })

  it('自定义代理应用到 dispatcher 与进程环境', async () => {
    const { EnvHttpProxyAgent } = await import('undici')
    const { NetworkProxyManager } = await import('../networkProxy')
    const manager = new NetworkProxyManager()

    await manager.apply({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7897',
    })

    expect(EnvHttpProxyAgent).toHaveBeenCalledWith({
      httpProxy: 'http://127.0.0.1:7897',
      httpsProxy: 'http://127.0.0.1:7897',
      noProxy: 'localhost,127.0.0.1,0.0.0.0,[::1],::1',
      proxyTls: {
        rejectUnauthorized: true,
      },
    })
    expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:7897')
    expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7897')
    expect(process.env.NO_PROXY).toContain('localhost')
    expect(process.env.http_proxy).toBe(process.env.HTTP_PROXY)
    expect(process.env.https_proxy).toBe(process.env.HTTPS_PROXY)
    expect(process.env.no_proxy).toBe(process.env.NO_PROXY)
    expect(mocks.setGlobalDispatcher).toHaveBeenCalledOnce()
  })

  it('系统代理模式恢复启动时的代理环境', async () => {
    process.env.HTTP_PROXY = 'http://system-proxy:8080'
    const { NetworkProxyManager } = await import('../networkProxy')
    const manager = new NetworkProxyManager()
    process.env.HTTP_PROXY = 'http://changed-proxy:9090'

    await manager.apply({ mode: 'system' })

    expect(process.env.HTTP_PROXY).toBe('http://system-proxy:8080')
    expect(process.env.HTTPS_PROXY).toBeUndefined()
  })

  it('无代理模式清空代理环境', async () => {
    const { Agent } = await import('undici')
    const { NetworkProxyManager } = await import('../networkProxy')
    const manager = new NetworkProxyManager()
    process.env.HTTP_PROXY = 'http://proxy:8080'

    await manager.apply({ mode: 'none' })

    expect(Agent).toHaveBeenCalledOnce()
    expect(process.env.HTTP_PROXY).toBeUndefined()
    expect(process.env.HTTPS_PROXY).toBeUndefined()
    expect(process.env.NO_PROXY).toBeUndefined()
  })

  it('自定义代理未填写 URL 时允许应用设置', async () => {
    const { NetworkProxyManager } = await import('../networkProxy')
    const manager = new NetworkProxyManager()

    await expect(manager.apply({ mode: 'custom' })).resolves.toBeUndefined()
  })

  it('使用隔离 dispatcher 测试代理连通性', async () => {
    const { NetworkProxyManager } = await import('../networkProxy')
    const manager = new NetworkProxyManager()

    await expect(manager.test('http://proxy:8080')).resolves.toBe(true)

    expect(mocks.fetch).toHaveBeenCalledWith('https://www.google.com/generate_204', expect.objectContaining({
      dispatcher: expect.anything(),
      signal: expect.any(AbortSignal),
    }))
    expect(mocks.agentClose).toHaveBeenCalledOnce()
  })

  it('销毁时恢复初始 dispatcher 与代理环境', async () => {
    process.env.HTTP_PROXY = 'http://system-proxy:8080'
    const { NetworkProxyManager } = await import('../networkProxy')
    const manager = new NetworkProxyManager()
    await manager.apply({
      mode: 'custom',
      customProxyUrl: 'http://custom-proxy:9090',
    })

    await manager.dispose()

    expect(mocks.setGlobalDispatcher).toHaveBeenLastCalledWith(mocks.initialDispatcher)
    expect(process.env.HTTP_PROXY).toBe('http://system-proxy:8080')
    expect(mocks.agentClose).toHaveBeenCalledOnce()
  })
})

describe('代理结果解析', () => {
  it('解析 HTTP 与 SOCKS 代理条目', async () => {
    const { parseProxyResult } = await import('../networkProxy')

    expect(parseProxyResult('PROXY 127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
    expect(parseProxyResult('SOCKS5 proxy.local:1080')).toBe('http://proxy.local:1080')
  })

  it('使用第一个支持的代理并忽略直连条目', async () => {
    const { parseProxyResult } = await import('../networkProxy')

    expect(parseProxyResult('DIRECT; HTTPS proxy.local:8443; PROXY fallback.local:8080'))
      .toBe('http://proxy.local:8443')
    expect(parseProxyResult('DIRECT')).toBeUndefined()
  })
})

function clearProxyEnvironment(): void {
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  delete process.env.NO_PROXY
  delete process.env.http_proxy
  delete process.env.https_proxy
  delete process.env.no_proxy
}
