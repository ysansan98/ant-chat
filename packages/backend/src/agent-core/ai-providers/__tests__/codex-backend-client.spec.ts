import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import type { CodexCredentials } from '../codex-auth'
import { CODEX_AUTH_ISSUER, CodexAuthSession, CodexOAuthCoordinator, parseCodexCliAuth } from '../codex-auth'
import { CodexBackendClient, CodexBackendError } from '../codex-backend-client'

function createCredentialStore(initial?: CodexCredentials) {
  let value = initial ?? null
  return {
    load: vi.fn(async () => value),
    save: vi.fn(async (_providerId: string, next: CodexCredentials) => {
      value = next
    }),
    clear: vi.fn(async () => {
      value = null
    }),
    get value() {
      return value
    },
  }
}

function createToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`
}

function createClient(store: ReturnType<typeof createCredentialStore>, fetchImpl: typeof fetch, now = Date.now) {
  return new CodexBackendClient({
    authSession: new CodexAuthSession('codex-1', store, fetchImpl, now),
    fetchImpl,
  })
}

describe('codexBackendClient 行为', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('把本机 Codex CLI 的 auth.json token bundle 映射为内部凭据', () => {
    const credentials = parseCodexCliAuth(JSON.stringify({
      auth_mode: 'chatgpt',
      last_refresh: '2026-08-03T10:00:00.000Z',
      tokens: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: createToken({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } }),
        account_id: 'account-1',
      },
    }), 1_000)

    expect(credentials).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accountId: 'account-1',
      planType: 'plus',
    })
  })

  it('解析 Codex 模型目录对象形态的 supported_reasoning_levels', async () => {
    const store = createCredentialStore({ accessToken: 'access-token' })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      models: [{
        slug: 'gpt-5.6-sol',
        display_name: 'GPT-5.6-Sol',
        input_modalities: ['text', 'image', 'pdf', 'audio'],
        supported_reasoning_levels: [
          { effort: 'low', description: 'Fast responses' },
          { effort: 'medium', description: 'Balanced responses' },
          { effort: 'high', description: 'Deep reasoning' },
          { effort: 'xhigh', description: 'Extra deep reasoning' },
        ],
      }],
    }), { status: 200 }))
    const client = createClient(store, fetchImpl)

    await expect(client.listModels()).resolves.toEqual([expect.objectContaining({
      id: 'gpt-5.6-sol',
      capabilities: expect.objectContaining({
        reasoning: true,
        reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
        inputModalities: ['text', 'image'],
      }),
    })])
  })

  it('access token 临近过期时先刷新 Keychain，再使用刷新后的 token', async () => {
    const now = 1_000_000
    const store = createCredentialStore({
      accessToken: 'old-access-token',
      refreshToken: 'refresh-token',
      expiresAt: now + 1_000,
    })
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-access-token', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }))
    const client = new CodexBackendClient({
      authSession: new CodexAuthSession('codex-1', store, fetchImpl, () => now),
      fetchImpl,
    })

    await client.listModels()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe(`${CODEX_AUTH_ISSUER}/oauth/token`)
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer new-access-token')
    expect(store.value?.accessToken).toBe('new-access-token')
  })

  it('同一认证会话的并发请求只执行一次 refresh', async () => {
    const now = 1_000_000
    const store = createCredentialStore({
      accessToken: 'old-access-token',
      refreshToken: 'refresh-token',
      expiresAt: now + 1_000,
    })
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-access-token', expires_in: 3600 }), { status: 200 }))
      .mockImplementation(async () => new Response(JSON.stringify({ models: [] }), { status: 200 }))
    const session = new CodexAuthSession('codex-1', store, fetchImpl, () => now)
    const first = new CodexBackendClient({ authSession: session, fetchImpl })
    const second = new CodexBackendClient({ authSession: session, fetchImpl })

    await Promise.all([first.listModels(), second.listModels()])

    expect(fetchImpl.mock.calls.filter(([url]) => String(url) === `${CODEX_AUTH_ISSUER}/oauth/token`)).toHaveLength(1)
    expect(store.save).toHaveBeenCalledTimes(1)
    expect(store.value?.accessToken).toBe('new-access-token')
  })

  it('认证状态区分可用、可刷新和已过期凭据', async () => {
    const now = 1_000_000
    const refreshableStore = createCredentialStore({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: now + 1_000 })
    const refreshableSession = new CodexAuthSession('codex-1', refreshableStore, vi.fn<typeof fetch>(), () => now)
    await expect(refreshableSession.getAuthStatus()).resolves.toMatchObject({ authenticated: true, state: 'refreshable' })

    const expiredStore = createCredentialStore({ accessToken: 'access-token', expiresAt: now + 1_000 })
    const expiredSession = new CodexAuthSession('codex-1', expiredStore, vi.fn<typeof fetch>(), () => now)
    await expect(expiredSession.getAuthStatus()).resolves.toMatchObject({ authenticated: false, state: 'expired' })
  })

  it('退出登录使进行中的 refresh 失效，旧结果不能写回凭据', async () => {
    const now = 1_000_000
    const store = createCredentialStore({ accessToken: 'old-access-token', refreshToken: 'refresh-token', expiresAt: now + 1_000 })
    let releaseRefresh!: (response: Response) => void
    let refreshStarted!: () => void
    const started = new Promise<void>(resolve => refreshStarted = resolve)
    const refreshResponse = new Promise<Response>(resolve => releaseRefresh = resolve)
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      refreshStarted()
      return await refreshResponse
    })
    const session = new CodexAuthSession('codex-1', store, fetchImpl, () => now)
    const refresh = session.getCredentials()
    await started
    const logout = session.logout()
    releaseRefresh(new Response(JSON.stringify({ access_token: 'new-access-token', expires_in: 3600 }), { status: 200 }))

    await expect(refresh).rejects.toThrow('登录状态已失效')
    await logout
    expect(store.save).not.toHaveBeenCalled()
    expect(store.value).toBeNull()
  })

  it('额度接口优先读取 Codex usage，旧 backend 返回 404 时回退到 WHAM usage', async () => {
    const store = createCredentialStore({ accessToken: 'access-token' })
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        plan_type: 'plus',
        rate_limit: {
          limit_reached: false,
          primary_window: { used_percent: 12, limit_window_seconds: 3600, reset_after_seconds: 120, reset_at: 2_000 },
        },
      }), { status: 200 }))
    const client = createClient(store, fetchImpl)

    await expect(client.getUsage()).resolves.toEqual({
      planType: 'plus',
      limitReached: false,
      primaryWindow: { usedPercent: 12, limitWindowSeconds: 3600, resetAfterSeconds: 120, resetAt: 2_000 },
    })
    expect(fetchImpl.mock.calls.map(call => String(call[0]))).toEqual([
      'https://chatgpt.com/backend-api/codex/usage',
      'https://chatgpt.com/backend-api/wham/usage',
    ])
  })

  it('usage 返回 HTML challenge 时回退到 WHAM JSON endpoint', async () => {
    const store = createCredentialStore({ accessToken: 'access-token' })
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith('/codex/usage')) {
        return new Response('<html>challenge</html>', {
          status: 403,
          headers: { 'Content-Type': 'text/html' },
        })
      }
      return new Response(JSON.stringify({
        plan_type: 'plus',
        rate_limit: { limit_reached: false },
      }), { status: 200 })
    })
    const client = createClient(store, fetchImpl)

    await expect(client.getUsage()).resolves.toEqual({
      planType: 'plus',
      limitReached: false,
    })
    expect(fetchImpl.mock.calls.map(call => String(call[0]))).toEqual([
      'https://chatgpt.com/backend-api/codex/usage',
      'https://chatgpt.com/backend-api/wham/usage',
    ])
  })

  it('错误响应只保留脱敏后的有限消息，不输出完整响应体', async () => {
    const store = createCredentialStore({ accessToken: 'access-token' })
    const responseMarker = '完整响应私有内容'
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'authorization=secret-value' },
      diagnostic: responseMarker,
    }), { status: 403 }))
    const client = createClient(store, fetchImpl)

    let caught: unknown
    try {
      await client.listModels()
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CodexBackendError)
    expect(caught).toMatchObject({ status: 403 })
    const message = caught instanceof Error ? caught.message : ''
    expect(message).toContain('authorization=[REDACTED]')
    expect(message).not.toContain('secret-value')
    expect(message).not.toContain(responseMarker)
  })

  it('responses fetch 拒绝固定 Codex endpoint 以外的 credential audience', async () => {
    const store = createCredentialStore({ accessToken: 'access-token' })
    const fetchImpl = vi.fn<typeof fetch>()
    const client = createClient(store, fetchImpl)

    await expect(client.fetchResponses('https://example.com/responses')).rejects.toMatchObject({
      status: 400,
      message: 'Codex Responses 请求目标不合法。',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('oAuth state 只能消费一次，并将授权码交换结果保存到 Keychain', async () => {
    const store = createCredentialStore()
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: createToken({ 'exp': 2_000, 'https://api.openai.com/auth': { chatgpt_account_id: 'account-1', chatgpt_plan_type: 'plus' } }),
      refresh_token: 'refresh-token',
      id_token: createToken({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-1' } }),
    }), { status: 200 }))
    const session = new CodexAuthSession('codex-1', store, fetchImpl, () => 1_000)
    const coordinator = new CodexOAuthCoordinator(session, fetchImpl, () => 1_000)
    const { authorizationUrl } = coordinator.start('codex-1', 'http://localhost:1234/callback')
    const state = new URL(authorizationUrl).searchParams.get('state')!

    await expect(coordinator.consumeCallback(new URLSearchParams({ state, code: 'auth-code' }))).resolves.toBe(true)
    await expect(coordinator.consumeCallback(new URLSearchParams({ state, code: 'auth-code' }))).resolves.toBe(false)
    expect(store.value).toMatchObject({
      refreshToken: 'refresh-token',
      accountId: 'account-1',
      planType: 'plus',
    })
    const body = fetchImpl.mock.calls[0][1]?.body
    expect(new URLSearchParams(String(body)).get('redirect_uri')).toBe('http://localhost:1234/callback')
  })

  it('退出登录使进行中的 OAuth callback 失效，旧 callback 不能恢复凭据', async () => {
    const store = createCredentialStore()
    let releaseExchange!: (response: Response) => void
    let exchangeStarted!: () => void
    const started = new Promise<void>(resolve => exchangeStarted = resolve)
    const exchangeResponse = new Promise<Response>(resolve => releaseExchange = resolve)
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      exchangeStarted()
      return await exchangeResponse
    })
    const session = new CodexAuthSession('codex-1', store, fetchImpl, () => 1_000)
    const coordinator = new CodexOAuthCoordinator(session, fetchImpl, () => 1_000)
    const { authorizationUrl } = coordinator.start('codex-1', 'http://localhost:1234/callback')
    const state = new URL(authorizationUrl).searchParams.get('state')!
    const callback = coordinator.consumeCallback(new URLSearchParams({ state, code: 'auth-code' }))
    await started

    coordinator.invalidate()
    const logout = session.logout()
    releaseExchange(new Response(JSON.stringify({ access_token: 'new-access-token', expires_in: 3600 }), { status: 200 }))

    await expect(callback).rejects.toThrow('OAuth 授权已因退出登录失效')
    await logout
    expect(store.save).not.toHaveBeenCalled()
    expect(store.value).toBeNull()
  })
})
