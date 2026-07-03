import type { AppRuntimeLoggerOptions } from '../runtimeLogger'
import type { SystemLogger } from '../systemLogger'

export interface CreateAppRuntimeOptions {
  appDataRoot: string
  logger?: SystemLogger
  loggerOptions?: AppRuntimeLoggerOptions
}
