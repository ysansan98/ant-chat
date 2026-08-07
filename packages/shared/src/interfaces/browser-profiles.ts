/** 应用托管的浏览器 Cookie。值只在主进程内部流转，不进入 RPC 或模型输入。 */
export interface BrowserCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  expires?: number
}

/** 浏览器身份导入后的运行时 Cookie provider。 */
export interface BrowserAuthStateProvider {
  getCookies: () => BrowserCookie[] | null
  getGeneration: () => number
  /** 清除应用托管登录态后通知运行中的 Browser 会话撤销自身。 */
  onClear?: (listener: () => void | Promise<void>) => () => void
  /** 浏览器工具执行前调用，确保底层持久化状态已加载；幂等，可并发调用。 */
  ensureInitialized?: () => Promise<void>
  /** 同步返回底层状态是否已加载；未加载时 getCookies/getGeneration 返回空值。 */
  isInitialized?: () => boolean
}

export type BrowserProfileKind = 'chrome' | 'edge' | 'chromium' | 'brave'

/** 可展示给设置页的浏览器 Profile，不包含本地路径。 */
export interface BrowserProfileSourceView {
  sourceId: string
  browserName: string
  profileName: string
  available: boolean
}

export interface BrowserIdentityStatus {
  imported: boolean
  browserName?: string
  profileName?: string
  importedAt?: number
  sourceAvailable?: boolean
  error?: string
}
