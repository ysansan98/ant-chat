import fs from 'node:fs'
import path from 'node:path'

import { APP_NAME } from './constants'
import { isDev } from './env'
import { getAppHand } from './util'

/**
 * 应用数据根目录（.ant-chat）
 * - 开发环境: <项目根目录>/.ant-chat
 * - 生产环境: <appData>/ant-chat
 */
export function getAppDataRoot(): string {
  if (isDev) {
    return path.join(findWorkspaceRoot(process.cwd()), '.ant-chat')
  }

  try {
    return path.join(getAppHand(), APP_NAME)
  }
  catch {
    return path.join(process.cwd(), '.ant-chat')
  }
}

function findWorkspaceRoot(start: string): string {
  let current = start
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return start
    }
    current = parent
  }
}
