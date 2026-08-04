import type { ProviderAuthStatus } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'

export const CODEX_DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api/codex'
export const CODEX_AUTH_ISSUER = 'https://auth.openai.com'
export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_OAUTH_SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke'
export const CODEX_ORIGINATOR = 'codex_cli_rs'

const REFRESH_EXPIRY_MARGIN_MS = 5 * 60 * 1000
const REFRESH_INTERVAL_MS = 55 * 60 * 1000
const AUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000

export interface CodexCredentials {
  accessToken: string
  refreshToken?: string
  idToken?: string
  accountId?: string
  planType?: string
  expiresAt?: number
  lastRefreshAt?: number
}

export interface CodexCredentialStore {
  load: (providerId: string) => Promise<CodexCredentials | null>
  save: (providerId: string, credentials: CodexCredentials) => Promise<void>
  clear: (providerId: string) => Promise<void>
}

export type CodexFetch = typeof fetch

export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexAuthError'
  }
}

export function tokenNeedsRefresh(credentials: CodexCredentials, now = Date.now()): boolean {
  if (credentials.expiresAt !== undefined) {
    return credentials.expiresAt <= now + REFRESH_EXPIRY_MARGIN_MS
  }
  return credentials.lastRefreshAt !== undefined
    && credentials.lastRefreshAt + REFRESH_INTERVAL_MS <= now
}

/**
 * 每个 Provider 唯一持有的认证会话。刷新、写入和退出登录都从这里经过，
 * 防止多个短生命周期 HTTP client 同时消费旋转 refresh token。
 */
export class CodexAuthSession {
  private generation = 0
  private refreshInFlight?: { generation: number, promise: Promise<CodexCredentials> }
  private writeQueue = Promise.resolve()

  constructor(
    readonly providerId: string,
    private readonly credentialStore: CodexCredentialStore,
    private readonly fetchImpl: CodexFetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  getGeneration(): number {
    return this.generation
  }

  async getCredentials(): Promise<CodexCredentials> {
    const generation = this.generation
    const credentials = await this.credentialStore.load(this.providerId)
    if (generation !== this.generation) {
      throw new CodexAuthError('Codex 登录状态已失效，请重新登录。')
    }
    if (!credentials) {
      throw new CodexAuthError('Codex 尚未登录，请先完成订阅授权。')
    }
    return tokenNeedsRefresh(credentials, this.now())
      ? await this.refreshOnce(credentials, generation)
      : credentials
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    const generation = this.generation
    const credentials = await this.credentialStore.load(this.providerId)
    if (generation !== this.generation || !credentials) {
      return { authenticated: false, state: 'missing' }
    }
    const state = tokenNeedsRefresh(credentials, this.now())
      ? credentials.refreshToken ? 'refreshable' : 'expired'
      : 'usable'
    return {
      authenticated: state !== 'expired',
      state,
      ...(credentials.accountId ? { accountId: credentials.accountId } : {}),
      ...(credentials.planType ? { planType: credentials.planType } : {}),
      ...(credentials.expiresAt ? { expiresAt: credentials.expiresAt } : {}),
    }
  }

  async save(credentials: CodexCredentials): Promise<void> {
    const saved = await this.saveAtGeneration(credentials, this.generation)
    if (!saved) {
      throw new CodexAuthError('Codex 登录状态已失效，新的凭据未写入。')
    }
  }

  async saveAtGeneration(credentials: CodexCredentials, generation: number): Promise<boolean> {
    return await this.enqueueWrite(async () => {
      if (generation !== this.generation) {
        return false
      }
      await this.credentialStore.save(this.providerId, credentials)
      return true
    })
  }

  async refresh(): Promise<CodexCredentials> {
    const generation = this.generation
    const credentials = await this.credentialStore.load(this.providerId)
    if (generation !== this.generation) {
      throw new CodexAuthError('Codex 登录状态已失效，请重新登录。')
    }
    if (!credentials) {
      throw new CodexAuthError('Codex 尚未登录，请先完成订阅授权。')
    }
    return await this.refreshOnce(credentials, generation)
  }

  async logout(): Promise<void> {
    this.generation += 1
    await this.enqueueWrite(() => this.credentialStore.clear(this.providerId))
  }

  /**
   * 只使会话在途的 refresh/写回失效（generation + 1），但不删除持久化凭据。
   * 用于 runtime dispose 或删除 Provider 时的内存清理，保留 Keychain 用户数据。
   */
  invalidate(): void {
    this.generation += 1
  }

  private async refreshOnce(credentials: CodexCredentials, generation: number): Promise<CodexCredentials> {
    if (this.refreshInFlight?.generation === generation) {
      return await this.refreshInFlight.promise
    }

    const promise = (async () => {
      const refreshed = await refreshCodexCredentials(credentials, { fetchImpl: this.fetchImpl, now: this.now })
      const saved = await this.saveAtGeneration(refreshed, generation)
      if (!saved) {
        throw new CodexAuthError('Codex 登录状态已失效，刷新结果未写入。')
      }
      return refreshed
    })()
    this.refreshInFlight = { generation, promise }
    void promise.finally(() => {
      if (this.refreshInFlight?.promise === promise) {
        this.refreshInFlight = undefined
      }
    }).catch(() => {})
    return await promise
  }

  private async enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue
    let release!: () => void
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    }
    finally {
      release()
    }
  }
}

export function parseCodexCredential(value: string | null): CodexCredentials | null {
  if (!value) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || typeof parsed.accessToken !== 'string' || parsed.accessToken.length === 0) {
      return null
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: asOptionalString(parsed.refreshToken),
      idToken: asOptionalString(parsed.idToken),
      accountId: asOptionalString(parsed.accountId),
      planType: asOptionalString(parsed.planType),
      expiresAt: asOptionalNumber(parsed.expiresAt),
      lastRefreshAt: asOptionalNumber(parsed.lastRefreshAt),
    }
  }
  catch {
    return null
  }
}

/**
 * 读取 Codex CLI 的 auth.json，但只把 token bundle 转成内部凭据；原始文件内容不离开后端。
 * CLI 使用 snake_case，Provider 内部统一使用 camelCase，避免把 CLI 文件格式扩散到运行时。
 */
export function parseCodexCliAuth(value: string | null, now = Date.now()): CodexCredentials | null {
  if (!value) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || parsed.auth_mode !== 'chatgpt' || !isRecord(parsed.tokens)) {
      return null
    }
    const tokens = parsed.tokens
    const accessToken = asOptionalString(tokens.access_token)
    if (!accessToken) {
      return null
    }
    const lastRefresh = typeof parsed.last_refresh === 'string' ? Date.parse(parsed.last_refresh) : undefined
    return credentialsFromTokenResponse({
      access_token: accessToken,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      account_id: tokens.account_id,
    }, typeof lastRefresh === 'number' && Number.isFinite(lastRefresh) ? lastRefresh : now)
  }
  catch {
    return null
  }
}

export function serializeCodexCredential(credentials: CodexCredentials): string {
  return JSON.stringify(credentials)
}

export function buildCodexAuthorizationUrl(input: {
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: CODEX_OAUTH_SCOPES,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state: input.state,
    originator: CODEX_ORIGINATOR,
  })
  return `${CODEX_AUTH_ISSUER}/oauth/authorize?${params.toString()}`
}

export class CodexOAuthCoordinator {
  private readonly pending = new Map<string, { providerId: string, generation: number, codeVerifier: string, redirectUri: string, createdAt: number }>()

  constructor(
    private readonly authSession: CodexAuthSession,
    private readonly fetchImpl: CodexFetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  start(providerId: string, redirectUri: string): { authorizationUrl: string } {
    this.expire()
    const codeVerifier = randomBytes(32).toString('base64url')
    const state = randomBytes(24).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    if (providerId !== this.authSession.providerId) {
      throw new CodexAuthError('Codex OAuth Provider 身份不匹配。')
    }
    this.pending.set(state, { providerId, generation: this.authSession.getGeneration(), codeVerifier, redirectUri, createdAt: this.now() })
    return {
      authorizationUrl: buildCodexAuthorizationUrl({ redirectUri, state, codeChallenge }),
    }
  }

  async consumeCallback(params: URLSearchParams): Promise<boolean> {
    this.expire()
    const state = params.get('state')
    if (!state) {
      return false
    }
    const attempt = this.pending.get(state)
    if (!attempt) {
      return false
    }
    this.pending.delete(state)
    if (attempt.generation !== this.authSession.getGeneration()) {
      throw new CodexAuthError('Codex OAuth 授权已因退出登录失效，请重新开始。')
    }

    const oauthError = params.get('error')
    if (oauthError) {
      throw new CodexAuthError(params.get('error_description') || oauthError)
    }
    const code = params.get('code')
    if (!code) {
      throw new CodexAuthError('Codex OAuth 回调缺少授权码。')
    }

    const tokenResponse = await exchangeCodexAuthorizationCode({
      code,
      codeVerifier: attempt.codeVerifier,
      redirectUri: attempt.redirectUri,
      fetchImpl: this.fetchImpl,
    })
    const saved = await this.authSession.saveAtGeneration(
      credentialsFromTokenResponse(tokenResponse, this.now()),
      attempt.generation,
    )
    if (!saved) {
      throw new CodexAuthError('Codex OAuth 授权已因退出登录失效，请重新开始。')
    }
    return true
  }

  invalidate(): void {
    this.pending.clear()
  }

  dispose(): void {
    this.invalidate()
  }

  private expire(): void {
    const cutoff = this.now() - AUTH_ATTEMPT_TTL_MS
    for (const [state, attempt] of this.pending) {
      if (attempt.createdAt <= cutoff) {
        this.pending.delete(state)
      }
    }
  }
}

export async function refreshCodexCredentials(
  credentials: CodexCredentials,
  options: { fetchImpl?: CodexFetch, now?: () => number } = {},
): Promise<CodexCredentials> {
  if (!credentials.refreshToken) {
    throw new CodexAuthError('Codex 登录已过期，请重新登录。')
  }
  const response = await (options.fetchImpl ?? globalThis.fetch)(`${CODEX_AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_OAUTH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      scope: 'openid profile email offline_access',
    }),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    throw new CodexAuthError(`Codex token 刷新失败（${response.status}）：${extractErrorMessage(payload)}`)
  }
  return credentialsFromTokenResponse(
    isRecord(payload) ? payload : {},
    (options.now ?? Date.now)(),
    credentials,
  )
}

async function exchangeCodexAuthorizationCode(input: {
  code: string
  codeVerifier: string
  redirectUri?: string
  fetchImpl: CodexFetch
}): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: CODEX_OAUTH_CLIENT_ID,
    code_verifier: input.codeVerifier,
  })
  if (input.redirectUri) {
    body.set('redirect_uri', input.redirectUri)
  }
  const response = await input.fetchImpl(`${CODEX_AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body,
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    throw new CodexAuthError(`Codex OAuth 换取 token 失败（${response.status}）：${extractErrorMessage(payload)}`)
  }
  if (!isRecord(payload) || typeof payload.access_token !== 'string') {
    throw new CodexAuthError('Codex OAuth 返回了无效的 token 响应。')
  }
  return payload
}

function credentialsFromTokenResponse(
  payload: Record<string, unknown>,
  now: number,
  previous?: CodexCredentials,
): CodexCredentials {
  const accessToken = asOptionalString(payload.access_token)
  if (!accessToken) {
    throw new CodexAuthError('Codex token 响应缺少 access_token。')
  }
  const idToken = asOptionalString(payload.id_token) || previous?.idToken
  const accessClaims = decodeJwtPayload(accessToken)
  const idClaims = idToken ? decodeJwtPayload(idToken) : {}
  const accessAuthClaims = getOpenAiAuthClaims(accessClaims)
  const idAuthClaims = getOpenAiAuthClaims(idClaims)
  const expiresIn = asOptionalNumber(payload.expires_in)

  return {
    accessToken,
    refreshToken: asOptionalString(payload.refresh_token) || previous?.refreshToken,
    idToken,
    accountId: asOptionalString(payload.account_id)
      || asOptionalString(idAuthClaims.chatgpt_account_id)
      || asOptionalString(accessAuthClaims.chatgpt_account_id)
      || previous?.accountId,
    planType: asOptionalString(accessAuthClaims.chatgpt_plan_type)
      || asOptionalString(idAuthClaims.chatgpt_plan_type)
      || previous?.planType,
    expiresAt: asOptionalNumber(accessClaims.exp) ? Number(accessClaims.exp) * 1000 : expiresIn ? now + expiresIn * 1000 : previous?.expiresAt,
    lastRefreshAt: now,
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1]
  if (!segment) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    return isRecord(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

function getOpenAiAuthClaims(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload['https://api.openai.com/auth']) ? payload['https://api.openai.com/auth'] : {}
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return {}
  }
  try {
    return JSON.parse(text)
  }
  catch {
    return { message: text }
  }
}

function extractErrorMessage(payload: unknown): string {
  if (isRecord(payload)) {
    const error = isRecord(payload.error) ? payload.error.message : undefined
    return asOptionalString(error) || asOptionalString(payload.message) || JSON.stringify(payload)
  }
  return String(payload)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
