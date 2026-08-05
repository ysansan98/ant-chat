import type { CommandHost } from '../agent-core/native-tools/command/types'
import type { AppRuntimeLoggerOptions } from '../runtimeLogger'
import type { SystemLogger } from '../systemLogger'
import type { DetectCommandHostOptions } from './commandHost'

/**
 * 宿主提供的 OAuth 回调能力。Runtime 只依赖这个最小协议，不感知 Electron、
 * localhost server 或浏览器打开方式。
 */
export interface OAuthCallbackHost {
  readonly redirectUrl: string
  /**
   * 解析某类 Provider Integration 的 OAuth 回调地址。Codex 这类有固定回调
   *  约束（OpenAI 只注册 1455/1457 + `/auth/callback`）的会解析到专用端点；
   *  未提供时调用方回退到 redirectUrl。
   */
  resolveOAuthRedirectUrl?: (integrationId: string) => Promise<string>
  openAuthorization: (url: string) => Promise<void>
  /** 每个 Runtime owner 独立订阅；disposer 可重复调用且不影响其他 owner。 */
  subscribeCallback: (handler: OAuthCallbackHandler) => () => void
}

export type OAuthCallbackHandler = (callbackParams: URLSearchParams) => Promise<boolean | void>

export function registerOAuthCallbackHandler(
  host: OAuthCallbackHost | undefined,
  handler: OAuthCallbackHandler,
): () => void {
  if (!host) {
    return () => {}
  }
  return host.subscribeCallback(handler)
}

export interface CreateAppRuntimeOptions {
  appDataRoot: string
  logger?: SystemLogger
  loggerOptions?: AppRuntimeLoggerOptions
  /** 添加到命令宿主探测边界的受控环境，例如桌面包内 CLI 的 PATH。 */
  commandEnvironment?: Record<string, string>
  /** 测试 seam：生产环境始终使用默认启动探测。 */
  commandHostDetector?: (options: DetectCommandHostOptions) => CommandHost
  /** 由桌面宿主在激活 Runtime 前启动的 OAuth 回调能力。 */
  oauthCallbackHost?: OAuthCallbackHost
}
