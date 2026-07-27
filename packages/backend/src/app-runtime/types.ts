import type { CommandHost } from '../agent-core/native-tools/command/types'
import type { AppRuntimeLoggerOptions } from '../runtimeLogger'
import type { SystemLogger } from '../systemLogger'
import type { DetectCommandHostOptions } from './commandHost'

export interface CreateAppRuntimeOptions {
  appDataRoot: string
  logger?: SystemLogger
  loggerOptions?: AppRuntimeLoggerOptions
  /** 添加到命令宿主探测边界的受控环境，例如桌面包内 CLI 的 PATH。 */
  commandEnvironment?: Record<string, string>
  /** 测试 seam：生产环境始终使用默认启动探测。 */
  commandHostDetector?: (options: DetectCommandHostOptions) => CommandHost
}
