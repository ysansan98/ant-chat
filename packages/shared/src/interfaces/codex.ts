export interface ProviderUsageWindow {
  usedPercent: number
  limitWindowSeconds: number
  resetAfterSeconds: number
  resetAt: number
}

export interface ProviderUsageStatus {
  planType?: string
  limitReached?: boolean
  primaryWindow?: ProviderUsageWindow
  secondaryWindow?: ProviderUsageWindow
  creditsBalance?: string
}

/** @deprecated 仅保留存量内部类型名，RPC 与 UI 使用 ProviderUsageStatus。 */
export type CodexUsageWindow = ProviderUsageWindow
/** @deprecated 仅保留存量内部类型名，RPC 与 UI 使用 ProviderUsageStatus。 */
export type CodexUsageStatus = ProviderUsageStatus
