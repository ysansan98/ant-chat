import path from 'node:path'
import { app } from 'electron'
import { APP_NAME } from './constants'
import { isDev } from './env'

const RUNTIME_DIR_ENV = 'ANT_CHAT_RUNTIME_DIR'

export function getRuntimeDataRoot(): string {
  const override = process.env[RUNTIME_DIR_ENV]?.trim()
  if (override) {
    return path.resolve(override)
  }

  if (isDev) {
    return path.join('.tmp', APP_NAME, 'agent')
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

export function getAgentLogsDir(): string {
  return path.join(getRuntimeDataRoot(), 'logs')
}
