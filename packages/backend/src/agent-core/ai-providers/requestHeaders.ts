/**
 * Provider 出站请求头注入。
 *
 * - 所有 LLM 请求的 User-Agent 统一覆盖为产品标识（如 `ant-chat/1.0.0`），
 *   替换 AI SDK 默认的 `ai/… ai-sdk/provider-utils/… runtime/…` 形态；
 * - OpenCode（opencode.ai）的会话内请求额外携带 `x-opencode-session`，
 *   值使用稳定的 conversationId。
 */

export interface ClientInfo {
  /** 产品名（如 ant-chat）。 */
  name: string
  /** 宿主版本；缺失时 User-Agent 只带产品名。 */
  version?: string
}

/**
 * OpenCode 服务的主机判定：opencode.ai 及其子域。
 * baseUrl 无法解析时视为否；合法 baseUrl 由 ProviderConfigSchema 的 url 校验兜底。
 */
export function isOpenCodeEndpoint(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'opencode.ai' || hostname.endsWith('.opencode.ai')
  }
  catch {
    return false
  }
}

export function buildUserAgent(clientInfo: ClientInfo): string {
  return clientInfo.version ? `${clientInfo.name}/${clientInfo.version}` : clientInfo.name
}

/**
 * 构造覆盖 User-Agent 的 fetch。
 *
 * 必须在 fetch 层覆盖：AI SDK 会对请求头里的 user-agent 追加自身标识
 * （provider-utils 的 withUserAgentSuffix），通过 headers 选项无法去掉。
 * 注意必须调用 globalThis.fetch，保持与 networkProxy 全局 dispatcher 一致。
 */
export function buildProviderFetch(clientInfo: ClientInfo): typeof fetch {
  const userAgent = buildUserAgent(clientInfo)
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('user-agent', userAgent)
    return await globalThis.fetch(input, { ...init, headers })
  }
}

/** 会话内请求的专属请求头（仅 OpenCode 端点）。 */
export function buildSessionHeaders(baseUrl: string, conversationId?: string): Record<string, string> {
  if (!conversationId?.trim() || !isOpenCodeEndpoint(baseUrl)) {
    return {}
  }
  return { 'x-opencode-session': conversationId }
}
