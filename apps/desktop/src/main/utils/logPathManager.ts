import path from 'node:path'
import { createAppRuntimePaths } from '@ant-chat/app-runtime'
import { resolveAppDataRoot } from '@ant-chat/shared'

export class LogPathManager {
  private static instance: LogPathManager

  static getInstance(): LogPathManager {
    if (!LogPathManager.instance) {
      LogPathManager.instance = new LogPathManager()
    }
    return LogPathManager.instance
  }

  private resolveDefaultDir(): string {
    return createAppRuntimePaths(resolveAppDataRoot()).logsRoot
  }

  getSystemLogPath(): string {
    return path.join(this.resolveDefaultDir(), 'main.log')
  }
}
