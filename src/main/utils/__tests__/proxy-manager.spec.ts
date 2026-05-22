import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setGlobalDispatcher: vi.fn(),
  agentClose: vi.fn(),
}))

vi.mock('undici', () => ({
  Agent: vi.fn(class Agent {
    close = mocks.agentClose
  }),
  EnvHttpProxyAgent: vi.fn(class EnvHttpProxyAgent {
    close = mocks.agentClose

    constructor(readonly options: unknown) {}
  }),
  setGlobalDispatcher: mocks.setGlobalDispatcher,
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@main/store/generalSettings', () => ({
  GeneralSettingsStore: {
    getInstance: () => ({
      getSettings: () => ({ proxySettings: { mode: 'none' } }),
    }),
  },
}))

vi.mock('../system-proxy', () => ({
  getSystemProxySettings: vi.fn(async () => ''),
}))

describe('proxy manager', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.NO_PROXY
    delete process.env.no_proxy
  })

  it('configures EnvHttpProxyAgent with localhost bypass', async () => {
    const { ProxyManager } = await import('../proxy-manager')
    const { EnvHttpProxyAgent } = await import('undici')

    await ProxyManager.getInstance().updateProxySettings({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7897',
    })

    expect(EnvHttpProxyAgent).toHaveBeenCalledWith(expect.objectContaining({
      httpProxy: 'http://127.0.0.1:7897',
      httpsProxy: 'http://127.0.0.1:7897',
      noProxy: expect.stringContaining('127.0.0.1'),
    }))
    expect(process.env.NO_PROXY).toContain('localhost')
    expect(process.env.NO_PROXY).toContain('127.0.0.1')
    expect(process.env.no_proxy).toBe(process.env.NO_PROXY)
    expect(mocks.setGlobalDispatcher).toHaveBeenCalled()
  })
})
