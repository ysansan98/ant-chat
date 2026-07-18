import type { AppRuntimeLoggerOptions } from '../runtimeLogger'
import type { SystemLogger } from '../systemLogger'

export interface CreateAppRuntimeOptions {
  appDataRoot: string
  logger?: SystemLogger
  loggerOptions?: AppRuntimeLoggerOptions
  /** 注入到 Agent bash 工具的受控环境。 */
  bashEnvironment?: Record<string, string>
}
