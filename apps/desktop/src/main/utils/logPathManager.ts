import path from 'node:path'
import { createAgentRuntimePaths } from '@ant-chat/agent-runtime'
import { getAppDataRoot } from './appPaths'

export class LogPathManager {
  private static instance: LogPathManager

  static getInstance(): LogPathManager {
    if (!LogPathManager.instance) {
      LogPathManager.instance = new LogPathManager()
    }
    return LogPathManager.instance
  }

  private resolveDefaultDir(): string {
    return createAgentRuntimePaths(getAppDataRoot()).logsRoot
  }

  getSystemLogPath(): string {
    return path.join(this.resolveDefaultDir(), 'main.log')
  }
}
