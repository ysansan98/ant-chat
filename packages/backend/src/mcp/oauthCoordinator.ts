import { randomUUID } from 'node:crypto'

export type OAuthAttemptPurpose = 'test' | 'persistent'
export type OAuthAttemptStatus = 'pending' | 'authorization-required' | 'callback-received' | 'completed' | 'failed' | 'cancelled' | 'expired'

export interface OAuthAttempt {
  id: string
  serverId: string
  purpose: OAuthAttemptPurpose
  state: string
  status: OAuthAttemptStatus
  authorizationUrl?: string
  error?: string
  createdAt: number
  expiresAt: number
}

export interface OAuthCallbackConsumption {
  attempt: OAuthAttempt
  callbackParams: URLSearchParams
}

export interface OAuthCoordinatorOptions {
  now?: () => number
  createId?: () => string
  createState?: () => string
  defaultTtlMs?: number
}

const DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000

/**
 * OAuth callback 的唯一 owner。state 在接收 callback 时立即移除，防止同一个
 * callback 被第二个 server 或重试流程再次消费；SDK token 交换仍由 transport adapter 负责。
 */
export class OAuthCoordinator {
  private readonly attempts = new Map<string, OAuthAttempt>()
  private readonly attemptIdByState = new Map<string, string>()
  private readonly now: () => number
  private readonly createId: () => string
  private readonly createState: () => string
  private readonly defaultTtlMs: number

  constructor(options: OAuthCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
    this.createState = options.createState ?? randomUUID
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_ATTEMPT_TTL_MS
  }

  begin(input: { serverId: string, purpose: OAuthAttemptPurpose, ttlMs?: number }): OAuthAttempt {
    this.expire()
    const createdAt = this.now()
    const state = this.createUniqueState()
    const attempt: OAuthAttempt = {
      id: this.createId(),
      serverId: input.serverId,
      purpose: input.purpose,
      state,
      status: 'pending',
      createdAt,
      expiresAt: createdAt + (input.ttlMs ?? this.defaultTtlMs),
    }
    this.attempts.set(attempt.id, attempt)
    this.attemptIdByState.set(state, attempt.id)
    return copyAttempt(attempt)
  }

  markAuthorizationRequired(input: { attemptId: string, authorizationUrl: string }): OAuthAttempt {
    const attempt = this.requireActiveAttempt(input.attemptId)
    const callbackState = new URL(input.authorizationUrl).searchParams.get('state')
    if (callbackState !== attempt.state) {
      throw new Error('OAuth authorization URL 的 state 与授权尝试不匹配。')
    }
    attempt.authorizationUrl = input.authorizationUrl
    attempt.status = 'authorization-required'
    return copyAttempt(attempt)
  }

  consumeCallback(callbackParams: URLSearchParams): OAuthCallbackConsumption | undefined {
    this.expire()
    const state = callbackParams.get('state')
    if (!state) {
      return undefined
    }
    const attemptId = this.attemptIdByState.get(state)
    if (!attemptId) {
      return undefined
    }
    const attempt = this.attempts.get(attemptId)
    if (!attempt || !isPending(attempt.status)) {
      return undefined
    }

    // 先移除索引再交给调用方完成 token 交换，确保并发 callback 也只能被消费一次。
    this.attemptIdByState.delete(state)
    if (callbackParams.get('error')) {
      attempt.status = 'failed'
      attempt.error = callbackParams.get('error_description') ?? callbackParams.get('error') ?? 'OAuth 授权失败。'
    }
    else {
      attempt.status = 'callback-received'
    }
    return { attempt: copyAttempt(attempt), callbackParams: new URLSearchParams(callbackParams) }
  }

  complete(attemptId: string): OAuthAttempt {
    const attempt = this.requireActiveAttempt(attemptId)
    if (attempt.status !== 'callback-received') {
      throw new Error('OAuth 授权尚未收到有效回调。')
    }
    attempt.status = 'completed'
    return copyAttempt(attempt)
  }

  fail(attemptId: string, error: unknown): OAuthAttempt {
    const attempt = this.requireActiveAttempt(attemptId)
    attempt.status = 'failed'
    attempt.error = error instanceof Error ? error.message : String(error)
    this.attemptIdByState.delete(attempt.state)
    return copyAttempt(attempt)
  }

  cancel(attemptId: string): OAuthAttempt | undefined {
    const attempt = this.attempts.get(attemptId)
    if (!attempt || !isPending(attempt.status)) {
      return attempt ? copyAttempt(attempt) : undefined
    }
    attempt.status = 'cancelled'
    this.attemptIdByState.delete(attempt.state)
    return copyAttempt(attempt)
  }

  /** server 被删除或替换时取消其尚未完成的授权，避免悬挂 callback 误入新连接。 */
  cancelForServer(serverId: string): OAuthAttempt[] {
    const cancelled: OAuthAttempt[] = []
    for (const attempt of this.attempts.values()) {
      if (attempt.serverId === serverId && isPending(attempt.status)) {
        const result = this.cancel(attempt.id)
        if (result) {
          cancelled.push(result)
        }
      }
    }
    return cancelled
  }

  /** 调用方已将最终状态交付给 UI 后可释放 attempt 的内存记录。 */
  dispose(attemptId: string): void {
    const attempt = this.attempts.get(attemptId)
    if (!attempt) {
      return
    }
    this.attemptIdByState.delete(attempt.state)
    this.attempts.delete(attemptId)
  }

  get(attemptId: string): OAuthAttempt | undefined {
    this.expire()
    const attempt = this.attempts.get(attemptId)
    return attempt ? copyAttempt(attempt) : undefined
  }

  expire(): OAuthAttempt[] {
    const now = this.now()
    const expired: OAuthAttempt[] = []
    for (const attempt of this.attempts.values()) {
      if (isPending(attempt.status) && attempt.expiresAt <= now) {
        attempt.status = 'expired'
        this.attemptIdByState.delete(attempt.state)
        expired.push(copyAttempt(attempt))
      }
    }
    return expired
  }

  private requireActiveAttempt(attemptId: string): OAuthAttempt {
    this.expire()
    const attempt = this.attempts.get(attemptId)
    if (!attempt) {
      throw new Error('OAuth 授权尝试不存在。')
    }
    if (!isPending(attempt.status)) {
      throw new Error(`OAuth 授权尝试已处于 ${attempt.status} 状态。`)
    }
    return attempt
  }

  private createUniqueState(): string {
    let state = this.createState()
    while (this.attemptIdByState.has(state)) {
      state = this.createState()
    }
    return state
  }
}

function isPending(status: OAuthAttemptStatus): boolean {
  return status === 'pending' || status === 'authorization-required' || status === 'callback-received'
}

function copyAttempt(attempt: OAuthAttempt): OAuthAttempt {
  return { ...attempt }
}
