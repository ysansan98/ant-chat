import type { AppRuntimeLoggerOptions } from '../runtimeLogger'
import type { SystemLogger } from '../systemLogger'

export interface CreateAppRuntimeOptions {
  appDataRoot: string
  logger?: SystemLogger
  loggerOptions?: AppRuntimeLoggerOptions
  /** 启用上下文诊断追踪（开发环境） */
  contextDiagnosticsEnabled?: boolean
}
