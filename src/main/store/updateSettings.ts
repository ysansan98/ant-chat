import type { UpdateConfig } from '@ant-chat/shared'
import Store from 'electron-store'

/**
 * 默认更新配置
 */
const DEFAULT_UPDATE_CONFIG: UpdateConfig = {
  autoCheck: true,
  autoDownload: true,
  checkInterval: 'startup',
  includePrerelease: false,
  lastCheckTime: 0,
}

/**
 * electron-store 配置 schema
 */
const schema = {
  updateConfig: {
    type: 'object' as const,
    properties: {
      autoCheck: {
        type: 'boolean' as const,
        default: true,
      },
      autoDownload: {
        type: 'boolean' as const,
        default: true,
      },
      checkInterval: {
        type: 'string' as const,
        enum: ['startup', 'daily', 'weekly'],
        default: 'startup',
      },
      includePrerelease: {
        type: 'boolean' as const,
        default: false,
      },
      lastCheckTime: {
        type: 'number' as const,
        default: 0,
      },
      skippedVersion: {
        type: 'string' as const,
      },
    },
    required: ['autoCheck', 'autoDownload', 'checkInterval', 'includePrerelease', 'lastCheckTime'],
  },
}

/**
 * 更新配置存储类
 *
 * 使用 electron-store 管理用户的更新偏好设置，包括：
 * - 自动检查更新开关
 * - 自动下载更新开关
 * - 检查更新频率
 * - 是否包含预发布版本
 * - 上次检查时间
 * - 跳过的版本号
 */
export class UpdateConfigStore {
  private static instance: UpdateConfigStore
  private store = new Store({
    name: 'update-settings',
    schema,
  })

  /**
   * 获取单例实例
   */
  static getInstance(): UpdateConfigStore {
    if (!UpdateConfigStore.instance) {
      UpdateConfigStore.instance = new UpdateConfigStore()
    }
    return UpdateConfigStore.instance
  }

  /**
   * 获取更新配置
   */
  getConfig(): UpdateConfig {
    return this.store.get('updateConfig', DEFAULT_UPDATE_CONFIG) as UpdateConfig
  }

  /**
   * 更新配置
   * @param updates 要更新的配置项
   */
  updateConfig(updates: Partial<UpdateConfig>): void {
    const currentConfig = this.getConfig()
    const newConfig = { ...currentConfig, ...updates }
    this.store.set('updateConfig', newConfig)
  }

  /**
   * 重置配置为默认值
   */
  resetConfig(): void {
    this.store.set('updateConfig', DEFAULT_UPDATE_CONFIG)
  }

  /**
   * 设置上次检查时间
   */
  setLastCheckTime(timestamp: number): void {
    this.updateConfig({ lastCheckTime: timestamp })
  }

  /**
   * 设置跳过的版本
   * @param version 要跳过的版本号
   */
  setSkippedVersion(version: string): void {
    this.updateConfig({ skippedVersion: version })
  }

  /**
   * 清除跳过的版本
   */
  clearSkippedVersion(): void {
    const config = this.getConfig()
    if (config.skippedVersion) {
      const { skippedVersion, ...configWithoutSkipped } = config
      this.store.set('updateConfig', configWithoutSkipped)
    }
  }

  /**
   * 检查是否应该跳过指定版本
   * @param version 版本号
   */
  shouldSkipVersion(version: string): boolean {
    const config = this.getConfig()
    return config.skippedVersion === version
  }

  /**
   * 检查是否需要检查更新（基于检查频率和上次检查时间）
   */
  shouldCheckForUpdates(): boolean {
    const config = this.getConfig()

    if (!config.autoCheck) {
      return false
    }

    const now = Date.now()
    const lastCheck = config.lastCheckTime

    switch (config.checkInterval) {
      case 'startup':
        return true // 每次启动都检查
      case 'daily':
        return now - lastCheck > 24 * 60 * 60 * 1000 // 24小时
      case 'weekly':
        return now - lastCheck > 7 * 24 * 60 * 60 * 1000 // 7天
      default:
        return true
    }
  }
}
