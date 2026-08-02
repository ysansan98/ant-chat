/**
 * 浏览器身份导入后的运行时认证状态。密钥只在主进程内部流转，不进入 RPC 或模型输入。
 */
export interface BrowserAuthStateProvider {
  getState: () => { statePath: string, encryptionKey: string } | null
  getGeneration: () => number
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
