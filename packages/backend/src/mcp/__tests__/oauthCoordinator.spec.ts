import { describe, expect, it } from 'vitest'
import { OAuthCoordinator } from '../oauthCoordinator'

function createCoordinator() {
  let now = 1_000
  let id = 0
  const coordinator = new OAuthCoordinator({
    now: () => now,
    createId: () => `attempt-${++id}`,
    createState: () => `state-${id + 1}`,
  })
  return {
    coordinator,
    advance: (milliseconds: number) => { now += milliseconds },
  }
}

describe('oauth coordinator', () => {
  it('只将 callback 交给 state 匹配的一个授权尝试，并拒绝重复消费', () => {
    const { coordinator } = createCoordinator()
    const first = coordinator.begin({ serverId: 'server-a', purpose: 'persistent' })
    const second = coordinator.begin({ serverId: 'server-b', purpose: 'test' })

    coordinator.markAuthorizationRequired({
      attemptId: second.id,
      authorizationUrl: `https://issuer.example.com/authorize?state=${second.state}`,
    })
    const callback = new URLSearchParams({ state: second.state, code: 'code-b' })

    expect(coordinator.consumeCallback(callback)).toEqual({
      attempt: expect.objectContaining({ id: second.id, serverId: 'server-b', status: 'callback-received' }),
      callbackParams: callback,
    })
    expect(coordinator.consumeCallback(callback)).toBeUndefined()
    expect(coordinator.get(first.id)).toMatchObject({ status: 'pending' })
  })

  it('取消或过期后不再接受 OAuth callback', () => {
    const { coordinator, advance } = createCoordinator()
    const cancelled = coordinator.begin({ serverId: 'server-a', purpose: 'test' })
    const expiring = coordinator.begin({ serverId: 'server-b', purpose: 'persistent', ttlMs: 100 })

    coordinator.cancel(cancelled.id)
    advance(100)

    expect(coordinator.consumeCallback(new URLSearchParams({ state: cancelled.state, code: 'ignored' }))).toBeUndefined()
    expect(coordinator.consumeCallback(new URLSearchParams({ state: expiring.state, code: 'ignored' }))).toBeUndefined()
    expect(coordinator.get(expiring.id)).toMatchObject({ status: 'expired' })
  })

  it('替换 server 时只取消该 server 的未完成授权', () => {
    const { coordinator } = createCoordinator()
    const first = coordinator.begin({ serverId: 'server-a', purpose: 'test' })
    const second = coordinator.begin({ serverId: 'server-b', purpose: 'persistent' })

    expect(coordinator.cancelForServer('server-a')).toEqual([expect.objectContaining({ id: first.id, status: 'cancelled' })])
    expect(coordinator.get(second.id)).toMatchObject({ status: 'pending' })
  })

  it('授权 URL 的 state 不匹配时不暴露为可完成的尝试', () => {
    const { coordinator } = createCoordinator()
    const attempt = coordinator.begin({ serverId: 'server-a', purpose: 'persistent' })

    expect(() => coordinator.markAuthorizationRequired({
      attemptId: attempt.id,
      authorizationUrl: 'https://issuer.example.com/authorize?state=other-state',
    })).toThrow('state')
    expect(coordinator.get(attempt.id)).toMatchObject({ status: 'pending' })
  })

  it('收到 OAuth 拒绝结果时保留失败状态而不进入 token 交换', () => {
    const { coordinator } = createCoordinator()
    const attempt = coordinator.begin({ serverId: 'server-a', purpose: 'persistent' })

    const consumed = coordinator.consumeCallback(new URLSearchParams({
      state: attempt.state,
      error: 'access_denied',
      error_description: '用户拒绝授权',
    }))

    expect(consumed?.attempt).toMatchObject({ status: 'failed', error: '用户拒绝授权' })
    expect(() => coordinator.complete(attempt.id)).toThrow('已处于 failed')
  })
})
