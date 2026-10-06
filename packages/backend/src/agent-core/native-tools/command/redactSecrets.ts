/** 把启动时解析出的密钥值替换为 `[secret]`，保证结果与日志跨 turn 读取都安全。 */
export function redactSecrets<T>(value: T, secrets: string[]): T {
  const replacements = sortReplacements(secrets)
  const visit = (current: unknown): unknown => {
    if (typeof current === 'string')
      return applyReplacements(current, replacements)
    if (Array.isArray(current))
      return current.map(visit)
    if (isPlainRecord(current))
      return Object.fromEntries(Object.entries(current).map(([key, item]) => [key, visit(item)]))
    return current
  }
  return visit(value) as T
}

/**
 * 流式脱敏器：按块替换密钥。
 *
 * 只有当前文本的后缀恰好是某个密钥的前缀时才暂留该后缀，
 * 避免密钥被 chunk 撕裂后泄露，同时不让普通文本因等待而延迟输出。
 */
export function createStreamRedactor(secrets: string[]): { write: (chunk: string) => string, flush: () => string } {
  const replacements = sortReplacements(secrets)
  const maxLength = replacements[0]?.length ?? 0
  let pending = ''
  const replace = (text: string): string => applyReplacements(text, replacements)
  return {
    write(chunk) {
      const text = pending + chunk
      const keep = maxLength > 1 ? pendingSuffixLength(text, replacements, maxLength) : 0
      pending = keep > 0 ? text.slice(text.length - keep) : ''
      return replace(keep > 0 ? text.slice(0, text.length - keep) : text)
    },
    flush() {
      const text = replace(pending)
      pending = ''
      return text
    },
  }
}

/** 返回需要暂留的后缀长度：该后缀必须是某个密钥的严格前缀。 */
function pendingSuffixLength(text: string, replacements: string[], maxLength: number): number {
  const max = Math.min(maxLength - 1, text.length)
  for (let length = max; length > 0; length--) {
    const suffix = text.slice(text.length - length)
    if (replacements.some(secret => secret.length > length && secret.startsWith(suffix)))
      return length
  }
  return 0
}

function sortReplacements(secrets: string[]): string[] {
  return secrets.filter(Boolean).sort((left, right) => right.length - left.length)
}

function applyReplacements(text: string, replacements: string[]): string {
  return replacements.reduce((current, secret) => current.split(secret).join('[secret]'), text)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
