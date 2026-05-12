import type { IAgentPathProvider } from '@ant-chat/shared'
import fs from 'node:fs/promises'
import path from 'node:path'

function maskValue(raw: unknown): unknown {
  if (typeof raw === 'string') {
    const maybeSecret = raw.replace(/(sk-[A-Za-z0-9]{10})[A-Za-z0-9-]*/g, '$1***')
    return maybeSecret
  }
  if (Array.isArray(raw))
    return raw.map(maskValue)
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, /token|secret|key|password|env/i.test(k) ? '***' : maskValue(v)]))
  }
  return raw
}

export function createAgentLogger(pathProvider: IAgentPathProvider) {
  async function appendAgentLog(conversationId: string, userMessageId: string, event: string, payload: Record<string, unknown>) {
    const root = pathProvider.getLogsDir()
    const logPath = path.join(root, conversationId, `${userMessageId}.jsonl`)
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    const line = JSON.stringify({ time: Date.now(), event, payload: maskValue(payload) })
    await fs.appendFile(logPath, `${line}\n`, 'utf8')
    return logPath
  }

  return { appendAgentLog }
}
