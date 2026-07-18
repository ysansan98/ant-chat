const SECRET_KEY = /(?:api[_-]?key|authorization|cookie|password|secret|token)$/i

export function redactObservabilityEvidence(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>())
}

function redactValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string')
    return redactString(value)
  if (isSecretRef(value))
    return { kind: 'secret_ref', id: '[secret-ref]', scope: value.scope }
  if (!value || typeof value !== 'object')
    return value
  if (ancestors.has(value))
    return '[circular]'
  ancestors.add(value)
  try {
    if (Array.isArray(value))
      return value.map(item => redactValue(item, ancestors))

    if (value instanceof Error)
      return redactError(value, ancestors)

    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      result[key] = SECRET_KEY.test(key) ? '[secret]' : redactValue(child, ancestors)
    }
    return result
  }
  finally {
    ancestors.delete(value)
  }
}

function redactError(error: Error, ancestors: WeakSet<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: redactString(error.name),
    message: redactString(error.message),
  }
  if (error.stack)
    result.stack = redactString(error.stack)
  if ('cause' in error && error.cause !== undefined)
    result.cause = redactValue(error.cause, ancestors)
  for (const [key, child] of Object.entries(error)) {
    if (key in result || key === 'cause')
      continue
    result[key] = SECRET_KEY.test(key) ? '[secret]' : redactValue(child, ancestors)
  }
  return result
}

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [secret]')
    .replace(/\b(?:sk|rk|pk)-[\w-]{12,}\b/g, '[secret]')
}

function isSecretRef(value: unknown): value is { kind: 'secret_ref', id: string, scope: unknown } {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === 'secret_ref'
    && typeof (value as { id?: unknown }).id === 'string'
}
