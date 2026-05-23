import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalWebTransport } from '../localWebTransport'

describe('localWebTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls local RPC endpoint and unwraps successful payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        success: true,
        data: {
          assistantModelId: 'model-1',
          proxySettings: { mode: 'none' },
        },
      }),
    })))

    const transport = createLocalWebTransport()
    const settings = await transport.settings.getSettings()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17331/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'settings.getSettings', params: {} }),
    })
    expect(settings).toEqual({
      assistantModelId: 'model-1',
      proxySettings: { mode: 'none' },
    })
  })

  it('throws failed RPC messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        success: false,
        msg: 'failed',
      }),
    })))

    const transport = createLocalWebTransport()

    await expect(transport.settings.getSettings()).rejects.toThrow('failed')
  })
})
