import fs from 'node:fs/promises'
import path from 'node:path'

function maskValue(raw: unknown): unknown {
  if (typeof raw === 'string') {
    const maybeSecret = raw.replace(/(sk-[A-Za-z0-9]{10})[A-Za-z0-9-]*/g, '$1***')
    return maybeSecret.length > 500 ? `${maybeSecret.slice(0, 500)}...(truncated)` : maybeSecret
  }
  if (Array.isArray(raw))
    return raw.map(maskValue)
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, /token|secret|key|password|env/i.test(k) ? '***' : maskValue(v)]))
  }
  return raw
}

export async function appendAgentLog(taskId: string, event: string, payload: Record<string, unknown>) {
  const date = new Date().toISOString().slice(0, 10)
  const root = path.join(process.cwd(), 'agent', 'logs', date)
  await fs.mkdir(root, { recursive: true })
  const logPath = path.join(root, `${taskId}.jsonl`)
  const line = JSON.stringify({ time: Date.now(), event, payload: maskValue(payload) })
  await fs.appendFile(logPath, `${line}\n`, 'utf8')
  return logPath
}
