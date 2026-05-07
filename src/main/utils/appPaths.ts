import path from 'node:path'
import { app } from 'electron'

const RUNTIME_DIR_ENV = 'ANT_CHAT_RUNTIME_DIR'

export function getRuntimeDataRoot(): string {
  const override = process.env[RUNTIME_DIR_ENV]?.trim()
  if (override) {
    return path.resolve(override)
  }

  try {
    return path.join(app.getPath('userData'), 'agent')
  }
  catch {
    return path.join(process.cwd(), '.ant-chat-runtime', 'agent')
  }
}

export function getAgentTasksDir(): string {
  return path.join(getRuntimeDataRoot(), 'tasks')
}

export function getAgentLogsDir(date = new Date().toISOString().slice(0, 10)): string {
  return path.join(getRuntimeDataRoot(), 'logs', date)
}
