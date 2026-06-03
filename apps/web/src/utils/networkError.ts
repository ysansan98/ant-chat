const NETWORK_ERROR_PATTERNS = /network|connection|fetch|abort|timeout|econnrefused|enotfound|socket|disconnected|econnreset|etimedout/i

/**
 * Lightweight UI-layer check: does the error text indicate a network / connectivity problem?
 * No schema changes required; pure string matching.
 */
export function isNetworkError(text: string): boolean {
  if (!text)
    return false
  return NETWORK_ERROR_PATTERNS.test(text)
}
