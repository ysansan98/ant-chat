/** Provider 订阅认证状态；不包含任何 token 明文。 */
export type ProviderAuthState = 'missing' | 'usable' | 'refreshable' | 'expired'

export interface ProviderAuthStatus {
  authenticated: boolean
  state: ProviderAuthState
  accountId?: string
  planType?: string
  expiresAt?: number
}
