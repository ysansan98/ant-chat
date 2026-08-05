import type { CodexUsageStatus, ProviderAuthStatus, ReasoningEffortLevel } from '@ant-chat/shared'
import type { CodexAuthSession } from './auth'
import { randomUUID } from 'node:crypto'
import { CODEX_DEFAULT_BASE_URL, CODEX_ORIGINATOR } from './auth'

export interface CodexModelInfo {
  id: string
  name: string
  contextLength?: number
  maxOutputTokens?: number
  capabilities?: {
    functionCall?: boolean
    reasoning?: boolean
    reasoningLevels?: ReasoningEffortLevel[]
    inputModalities?: Array<'text' | 'image' | 'pdf' | 'video' | 'audio'>
  }
}

/** Codex backend 会按客户端版本裁剪模型目录。 */
export const CODEX_MODELS_CLIENT_VERSION = '0.146.0'

export class CodexBackendError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'CodexBackendError'
  }
}

/**
 * Codex subscription 的授权 HTTP client。
 *
 * 模型生成由 CodexAIProvider 通过 AI SDK 完成；这里仅拥有固定 endpoint、
 * token 刷新、模型目录和额度查询。
 */
export class CodexBackendClient {
  private readonly baseUrl = CODEX_DEFAULT_BASE_URL
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly options: {
      authSession: CodexAuthSession
      fetchImpl?: typeof fetch
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    return await this.options.authSession.getAuthStatus()
  }

  async logout(): Promise<void> {
    await this.options.authSession.logout()
  }

  async getUsage(): Promise<CodexUsageStatus> {
    const candidateUrls = [
      `${this.baseUrl}/usage`,
      `${getBackendApiRoot(this.baseUrl)}/wham/usage`,
    ]
    let lastResponse: Response | undefined
    for (const url of candidateUrls) {
      const response = await this.authorizedFetch(url, { headers: { Accept: 'application/json' } })
      lastResponse = response
      if (response.ok) {
        return normalizeCodexUsage(await readJsonObject(response))
      }
      const isHtmlChallenge = response.status === 403
        && response.headers.get('content-type')?.toLowerCase().includes('text/html')
      if (response.status !== 404 && !isHtmlChallenge) {
        throw await toBackendError(response)
      }
    }
    throw await toBackendError(lastResponse!)
  }

  async listModels(): Promise<CodexModelInfo[]> {
    const url = new URL(`${this.baseUrl}/models`)
    url.searchParams.set('client_version', CODEX_MODELS_CLIENT_VERSION)
    const response = await this.authorizedFetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) {
      throw await toBackendError(response)
    }
    const payload = await readJsonObject(response)
    const rawModels = Array.isArray(payload.models) ? payload.models : []
    return rawModels.flatMap((raw): CodexModelInfo[] => {
      if (!isRecord(raw) || typeof raw.slug !== 'string') {
        return []
      }
      const inputModalities = normalizeCodexInputModalities(raw.input_modalities)
      const reasoningLevels = normalizeReasoningLevels(raw.supported_reasoning_levels)
      return [{
        id: raw.slug,
        name: asString(raw.display_name) || raw.slug,
        contextLength: asNumber(raw.context_window),
        maxOutputTokens: asNumber(raw.max_output_tokens) ?? 4096,
        capabilities: {
          functionCall: true,
          reasoning: asBoolean(raw.supports_reasoning_summaries) || Boolean(reasoningLevels?.length),
          ...(reasoningLevels?.length ? { reasoningLevels } : {}),
          ...(inputModalities?.length ? { inputModalities } : {}),
        },
      }]
    })
  }

  /**
   * 仅供 AI SDK Responses model 使用。目标校验固定 credential audience，
   * 避免 OAuth token 被自定义 Provider 配置或错误调用重定向。
   */
  readonly fetchResponses = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = toRequestUrl(input)
    if (target !== `${this.baseUrl}/responses`) {
      throw new CodexBackendError(400, 'Codex Responses 请求目标不合法。')
    }
    const response = await this.authorizedFetch(input, init)
    if (!response.ok) {
      throw await toBackendError(response)
    }
    return response
  }

  private async authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}, retry = true): Promise<Response> {
    const credentials = await this.options.authSession.getCredentials()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${credentials.accessToken}`)
    headers.set('originator', CODEX_ORIGINATOR)
    headers.set('OpenAI-Beta', 'responses=experimental')
    headers.set('x-client-request-id', randomUUID())
    if (credentials.accountId) {
      headers.set('ChatGPT-Account-ID', credentials.accountId)
    }
    else {
      headers.delete('ChatGPT-Account-ID')
    }

    const response = await this.fetchImpl(input, { ...init, headers })
    if (response.status === 401 && retry && credentials.refreshToken) {
      await this.options.authSession.refresh()
      return await this.authorizedFetch(input, init, false)
    }
    return response
  }
}

function toRequestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.toString()
  }
  return typeof input === 'string' ? input : input.url
}

function normalizeCodexUsage(value: Record<string, unknown>): CodexUsageStatus {
  const rateLimit = isRecord(value.rate_limit) ? value.rate_limit : {}
  const primaryWindow = normalizeUsageWindow(rateLimit.primary_window)
  const secondaryWindow = normalizeUsageWindow(rateLimit.secondary_window)
  const credits = isRecord(value.credits) ? value.credits : {}
  return {
    ...(asString(value.plan_type) ? { planType: asString(value.plan_type) } : {}),
    ...(typeof rateLimit.limit_reached === 'boolean' ? { limitReached: rateLimit.limit_reached } : {}),
    ...(primaryWindow ? { primaryWindow } : {}),
    ...(secondaryWindow ? { secondaryWindow } : {}),
    ...(asString(credits.balance) ? { creditsBalance: asString(credits.balance) } : {}),
  }
}

function normalizeUsageWindow(value: unknown): CodexUsageStatus['primaryWindow'] {
  if (!isRecord(value)) {
    return undefined
  }
  const usedPercent = asNumber(value.used_percent)
  const limitWindowSeconds = asNumber(value.limit_window_seconds)
  const resetAfterSeconds = asNumber(value.reset_after_seconds)
  const resetAt = asNumber(value.reset_at)
  if (usedPercent === undefined || limitWindowSeconds === undefined || resetAfterSeconds === undefined || resetAt === undefined) {
    return undefined
  }
  return { usedPercent, limitWindowSeconds, resetAfterSeconds, resetAt }
}

async function toBackendError(response: Response): Promise<CodexBackendError> {
  const body = await response.text()
  let message: string | undefined
  try {
    const parsed: unknown = JSON.parse(body)
    if (isRecord(parsed)) {
      const error = isRecord(parsed.error) ? parsed.error.message : undefined
      message = asString(error) || asString(parsed.detail) || asString(parsed.message) || undefined
    }
  }
  catch {
    // 非 JSON 错误体可能是 HTML challenge 或包含敏感字段，不能写入异常消息。
  }
  return new CodexBackendError(response.status, `Codex backend 请求失败（${response.status}）：${sanitizeBackendErrorMessage(message)}`)
}

function sanitizeBackendErrorMessage(value: string | undefined): string {
  if (!value) {
    return '未知错误'
  }
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(access[_-]?token|refresh[_-]?token|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 256)
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json()
  return isRecord(payload) ? payload : {}
}

function getBackendApiRoot(baseUrl: string): string {
  return baseUrl.endsWith('/codex') ? baseUrl.slice(0, -'/codex'.length) : baseUrl
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean {
  return value === true
}

type ModelInputModality = 'text' | 'image' | 'pdf' | 'video' | 'audio'

function isModelInputModality(value: unknown): value is ModelInputModality {
  return value === 'text' || value === 'image' || value === 'pdf' || value === 'video' || value === 'audio'
}

function normalizeCodexInputModalities(value: unknown): Array<'text' | 'image'> | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const modalities = value
    .filter(isModelInputModality)
    .filter((modality): modality is 'text' | 'image' => modality === 'text' || modality === 'image')
  return modalities.length > 0 ? [...new Set(modalities)] : undefined
}

function isReasoningEffortLevel(value: unknown): value is ReasoningEffortLevel {
  return value === 'provider-default'
    || value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
}

function normalizeReasoningLevels(value: unknown): ReasoningEffortLevel[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const levels = value.flatMap((entry) => {
    const effort = isRecord(entry) ? asString(entry.effort) : asString(entry)
    const normalized = effort === 'max' ? 'xhigh' : effort
    return isReasoningEffortLevel(normalized) ? [normalized] : []
  })
  const uniqueLevels = [...new Set(levels)]
  return uniqueLevels.length > 0 ? uniqueLevels : undefined
}
