import { afterEach, describe, expect, it, vi } from 'vitest'
import { localRpc } from '../appRpc'

describe('appRpc local transport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('调用本地 RPC 端点并解包成功响应', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        success: true,
        data: {
          assistantModelId: 'model-1',
          proxySettings: { mode: 'none' },
        },
      }),
    })))

    const settings = await localRpc('settings.getSettings', undefined)

    expect(fetch).toHaveBeenCalledWith('/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'settings.getSettings', input: undefined }),
    })
    expect(settings).toEqual({
      assistantModelId: 'model-1',
      proxySettings: { mode: 'none' },
    })
  })

  it('抛出失败 RPC 的错误消息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        success: false,
        msg: 'failed',
      }),
    })))

    await expect(localRpc('settings.getSettings', undefined)).rejects.toThrow('failed')
  })

  it('发送 typed RPC 的 input payload', async () => {
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

    const memory = await localRpc('memory.updateMemoryFiles', { input: { soulMarkdown: '# SOUL\n\n- Be direct.' } })

    expect(fetch).toHaveBeenCalledWith('/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'memory.updateMemoryFiles',
        input: { input: { soulMarkdown: '# SOUL\n\n- Be direct.' } },
      }),
    })
    expect(memory.soulMarkdown).toBe('# SOUL')
  })
})
