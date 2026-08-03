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
