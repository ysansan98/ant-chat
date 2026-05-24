import path from 'node:path'
import { getAppDataRoot } from './appPaths'

/**
 * 统一日志路径管理器。
 *
 * 路径优先级：electron-store 设置 > getAppDataRoot()/logs 默认值
 *
 * 支持运行时动态重配：用户通过设置界面修改日志目录后，
 * 调用 reconfigure() 即可实时切换，无需重启应用。
 */
export class LogPathManager {
  private static instance: LogPathManager
  private baseDir: string

  private constructor() {
    this.baseDir = this.resolveDefaultDir()
  }

  static getInstance(): LogPathManager {
    if (!LogPathManager.instance) {
      LogPathManager.instance = new LogPathManager()
    }
    return LogPathManager.instance
  }

  private resolveDefaultDir(): string {
    // 与其他应用数据（DB、skills 等）放在同一根目录下
    // - 开发环境: {项目根}/.ant-chat/logs
    // - 生产环境: {appData}/ant-chat/logs
    return path.join(getAppDataRoot(), 'logs')
  }

  /** 系统级日志文件路径 */
  getSystemLogPath(): string {
    return path.join(this.baseDir, 'main.log')
  }

  /** 按任务的 JSONL 日志文件路径 */
  getTaskLogPath(conversationId: string, userMessageId: string): string {
    return path.join(this.baseDir, 'tasks', conversationId, `${userMessageId}.jsonl`)
  }

  /** 运行时动态切换日志根目录（用户通过设置界面修改后调用） */
  reconfigure(newBaseDir: string): void {
    this.baseDir = newBaseDir
  }
}
