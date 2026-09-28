import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildProviderFetch, buildSessionHeaders, buildUserAgent, isOpenCodeEndpoint } from '../requestHeaders'

describe('isOpenCodeEndpoint', () => {
  it('识别 opencode.ai 主域、子域与大小写', () => {
    expect(isOpenCodeEndpoint('https://opencode.ai/zen/go/v1')).toBe(true)
    expect(isOpenCodeEndpoint('https://OpenCode.ai/zen/v1')).toBe(true)
    expect(isOpenCodeEndpoint('https://foo.opencode.ai/v1')).toBe(true)
  })

  it('拒绝其他域名、仿冒域名与非法 URL', () => {
    expect(isOpenCodeEndpoint('https://api.openai.com/v1')).toBe(false)
    expect(isOpenCodeEndpoint('https://opencode.ai.evil.com/v1')).toBe(false)
    expect(isOpenCodeEndpoint('not-a-url')).toBe(false)
    expect(isOpenCodeEndpoint('')).toBe(false)
  })
})

describe('buildUserAgent', () => {
  it('带版本时输出 name/version', () => {
    expect(buildUserAgent({ name: 'ant-chat', version: '1.0.0-alpha.7' })).toBe('ant-chat/1.0.0-alpha.7')
  })

  it('缺版本时仅输出 name', () => {
    expect(buildUserAgent({ name: 'ant-chat' })).toBe('ant-chat')
  })
})

describe('buildProviderFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('覆盖 user-agent 且保留既有请求头与其他 init 字段', async () => {
    const calls: Array<{ input: unknown, init: RequestInit }> = []
    const stub = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init: init! })
      return new Response('ok')
    })
    vi.stubGlobal('fetch', stub)

    const wrappedFetch = buildProviderFetch({ name: 'ant-chat', version: '1.0.0-alpha.7' })
    await wrappedFetch('https://opencode.ai/zen/go/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'ai/7.0.18 ai-sdk/provider-utils/5.0.6',
        'x-opencode-session': 'conv-1',
      },
      body: '{"ok":true}',
    })

    expect(stub).toHaveBeenCalledTimes(1)
    const init = calls[0].init
    const headers = new Headers(init.headers)
    expect(headers.get('user-agent')).toBe('ant-chat/1.0.0-alpha.7')
    expect(headers.get('x-opencode-session')).toBe('conv-1')
    expect(headers.get('content-type')).toBe('application/json')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"ok":true}')
  })
})

describe('buildSessionHeaders', () => {
  it('opencode 端点且有会话 ID 时注入 x-opencode-session', () => {
    expect(buildSessionHeaders('https://opencode.ai/zen/go/v1', 'conv-1')).toEqual({ 'x-opencode-session': 'conv-1' })
  })

  it('非 OpenCode 端点不注入', () => {
    expect(buildSessionHeaders('https://api.openai.com/v1', 'conv-1')).toEqual({})
  })

  it('缺少会话 ID 时不注入', () => {
    expect(buildSessionHeaders('https://opencode.ai/zen/go/v1', undefined)).toEqual({})
    expect(buildSessionHeaders('https://opencode.ai/zen/go/v1', '  ')).toEqual({})
  })
})
