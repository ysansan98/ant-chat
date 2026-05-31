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

    expect(fetch).toHaveBeenCalledWith('/api/rpc', {
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

  it('sends memory update through local RPC', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        success: true,
        data: {
          memoryRootPath: '/tmp/memory',
          userMarkdown: '§Use Chinese.',
          memoryMarkdown: '§Run pnpm check.',
          soulMarkdown: '# SOUL',
        },
      }),
    })))

    const transport = createLocalWebTransport()
    const memory = await transport.memory.updateMemoryFiles({ soulMarkdown: '# SOUL\n\n- Be direct.' })

    expect(fetch).toHaveBeenCalledWith('/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'memory.updateMemoryFiles',
        params: { input: { soulMarkdown: '# SOUL\n\n- Be direct.' } },
      }),
    })
    expect(memory.soulMarkdown).toBe('# SOUL')
  })
})
