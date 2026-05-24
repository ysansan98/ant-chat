import path from 'node:path'
import { app } from 'electron'
import { APP_NAME } from './constants'
import { isDev } from './env'
import { getAppHand } from './util'

const RUNTIME_DIR_ENV = 'ANT_CHAT_RUNTIME_DIR'
const APP_DATA_DIR_ENV = 'ANT_CHAT_APP_DATA_DIR'

/**
 * 应用数据根目录（.ant-chat）
 * - 开发环境: <项目根目录>/.ant-chat
 * - 生产环境: <appData>/ant-chat
 * - 可通过环境变量 ANT_CHAT_APP_DATA_DIR 覆盖
 */
export function getAppDataRoot(): string {
  const override = process.env[APP_DATA_DIR_ENV]?.trim()
  if (override) {
    return path.resolve(override)
  }

  if (isDev) {
    return path.join(process.cwd(), '.ant-chat')
  }

  try {
    return path.join(getAppHand(), APP_NAME)
  }
  catch {
    return path.join(process.cwd(), '.ant-chat')
  }
}

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
