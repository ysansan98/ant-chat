/**
 * 更新配置接口
 */
export interface UpdateConfig {
  /** 自动检查更新 - 默认: true */
  autoCheck: boolean
  /** 自动下载更新 - 默认: true */
  autoDownload: boolean
  /** 检查更新频率 - 默认: 'startup' */
  checkInterval: 'startup' | 'daily' | 'weekly'
  /** 包含预发布版本 - 默认: false */
  includePrerelease: boolean
  /** 上次检查时间戳 */
  lastCheckTime: number
  /** 用户选择跳过的版本 */
  skippedVersion?: string
}

/**
 * 更新信息接口
 */
export interface UpdateInfo {
  /** 版本号 */
  version: string
  /** 发布日期 */
  releaseDate: string
  /** 更新日志 */
  releaseNotes: string | { note: string | null, version: string }[]
  /** 下载大小（字节） */
  downloadSize: number
  /** 下载链接 */
  downloadUrl: string
}

/**
 * 下载进度信息接口
 */
export interface ProgressInfo {
  /** 下载进度百分比 (0-100) */
  percent: number
  /** 下载速度（字节/秒） */
  bytesPerSecond: number
  /** 总大小（字节） */
  total: number
  /** 已传输大小（字节） */
  transferred: number
}

/**
 * 更新状态类型
 */
export type UpdateStatus
  = 'idle' // 空闲状态
    | 'checking' // 正在检查更新
    | 'available' // 有可用更新
    | 'not-available' // 无可用更新
    | 'downloading' // 正在下载
    | 'downloaded' // 下载完成
    | 'error' // 错误状态

/**
 * 更新错误类型
 */
export type UpdateErrorType
  = | 'NETWORK_ERROR' // 网络连接错误
    | 'DOWNLOAD_ERROR' // 下载失败错误
    | 'SIGNATURE_ERROR' // 签名验证错误
    | 'INSTALL_ERROR' // 安装失败错误
    | 'PERMISSION_ERROR' // 权限不足错误
    | 'DISK_SPACE_ERROR' // 磁盘空间不足错误
    | 'UNKNOWN_ERROR' // 未知错误

/**
 * 错误恢复建议类型
 */
export interface UpdateRecoveryAction {
  /** 建议类型 */
  type: 'retry' | 'manual_download' | 'restart_app' | 'check_permission' | 'free_space' | 'contact_support'
  /** 建议标题 */
  title: string
  /** 建议描述 */
  description: string
  /** 操作链接（可选） */
  url?: string
}

/**
 * 更新错误接口
 */
export interface UpdateError {
  /** 错误类型 */
  type: UpdateErrorType
  /** 错误代码 */
  code?: string
  /** 错误消息 */
  message: string
  /** 用户友好的错误描述 */
  userMessage: string
  /** 错误详情 */
  details?: any
  /** 恢复建议 */
  recoveryActions: UpdateRecoveryAction[]
  /** 错误发生时间 */
  timestamp: number
  /** 是否可重试 */
  retryable: boolean
}
