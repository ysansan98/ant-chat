import type { ProgressInfo, UpdateConfig, UpdateInfo, UpdateStatus } from '@ant-chat/shared'
import { UpdateConfigStore } from '@main/store/updateSettings'
import { isDev } from '@main/utils/env'
import { mainEmitter } from '@main/utils/ipc-events-bus'
import { logger } from '@main/utils/logger'
import { UpdateErrorHandler } from '@main/utils/updateErrorHandler'
import { app } from 'electron'
import { autoUpdater, CancellationToken } from 'electron-updater'

autoUpdater.logger = logger

/**
 * 更新服务类
 *
 * 负责管理应用的自动更新功能，包括：
 * - 检查更新
 * - 下载更新
 * - 安装更新
 * - 更新状态管理
 * - 配置管理
 */
export class UpdateService {
  private static instance: UpdateService
  private configStore: UpdateConfigStore
  private isInitialized = false
  private currentStatus: UpdateStatus = 'idle'
  private updateInfo: UpdateInfo | null = null
  private mainWidnow: Electron.BrowserWindow | null = null
  private cancellationToken: CancellationToken | null = null

  private constructor() {
    this.configStore = UpdateConfigStore.getInstance()
    this.setupAutoUpdater()
  }

  /**
   * 获取单例实例
   */
  static getInstance(): UpdateService {
    if (!UpdateService.instance) {
      UpdateService.instance = new UpdateService()
    }
    return UpdateService.instance
  }

  /**
   * 初始化更新服务
   */
  async initialize(mainWindow: Electron.BrowserWindow): Promise<void> {
    if (this.isInitialized) {
      return
    }

    this.mainWidnow = mainWindow

    if (isDev) {
      // 在开发模式下，我们通过 dev-app-update.yml 手动配置
      autoUpdater.forceDevUpdateConfig = true
    }

    try {
      // 配置 autoUpdater
      this.configureAutoUpdater()

      // 检查是否需要在启动时检查更新
      const config = this.configStore.getConfig()
      if (config.autoCheck && this.configStore.shouldCheckForUpdates()) {
        await this.checkForUpdates()
      }

      this.isInitialized = true
      logger.info('更新服务初始化完成')
    }
    catch (error) {
      logger.error('更新服务初始化失败:', error)
      throw error
    }
  }

  /**
   * 配置 autoUpdater
   */
  private configureAutoUpdater(): void {
    const config = this.configStore.getConfig()

    // 设置是否包含预发布版本
    autoUpdater.allowPrerelease = config.includePrerelease

    // 设置自动下载
    autoUpdater.autoDownload = config.autoDownload

    // 设置自动安装和重启（通常设为 false，让用户手动确认）
    autoUpdater.autoInstallOnAppQuit = false

    logger.info('autoUpdater 配置完成', {
      allowPrerelease: config.includePrerelease,
      autoDownload: config.autoDownload,
    })
  }

  /**
   * 设置 autoUpdater 事件监听器
   */
  private setupAutoUpdater(): void {
    // 检查更新时触发
    autoUpdater.on('checking-for-update', () => {
      this.currentStatus = 'checking'
      logger.info('开始检查更新')
      this.emitStatusUpdate()
    })

    // 发现可用更新时触发
    autoUpdater.on('update-available', (info) => {
      this.currentStatus = 'available'

      this.updateInfo = {
        version: info.version,
        releaseDate: info.releaseDate || new Date().toISOString(),
        releaseNotes: info.releaseNotes || '',
        downloadSize: info.files?.[0]?.size || 0,
        downloadUrl: info.files?.[0]?.url || '',
      }

      logger.info('发现可用更新', { version: info.version })
      this.emitStatusUpdate()

      // 检查是否应该跳过此版本
      if (this.configStore.shouldSkipVersion(info.version)) {
        logger.info(`跳过版本 ${info.version}`)
        this.currentStatus = 'idle'
        this.emitStatusUpdate()
        return
      }

      // 如果启用了自动下载，则开始下载
      const config = this.configStore.getConfig()
      if (config.autoDownload) {
        this.downloadUpdate()
      }
    })

    // 没有可用更新时触发
    autoUpdater.on('update-not-available', (info) => {
      this.currentStatus = 'idle'
      logger.info('没有可用更新', { version: info.version })
      this.configStore.setLastCheckTime(Date.now())
      this.emitStatusUpdate()
    })

    // 下载进度更新时触发
    autoUpdater.on('download-progress', (progress) => {
      this.currentStatus = 'downloading'
      const progressInfo: ProgressInfo = {
        bytesPerSecond: progress.bytesPerSecond,
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      }

      logger.debug('下载进度更新', progressInfo)
      this.emitProgressUpdate(progressInfo)
    })

    // 下载完成时触发
    autoUpdater.on('update-downloaded', (info) => {
      this.currentStatus = 'downloaded'
      logger.info('更新下载完成', { version: info.version })
      this.emitUpdateDownloaded()
    })

    // 发生错误时触发
    autoUpdater.on('error', (error) => {
      this.currentStatus = 'error'
      const handledError = UpdateErrorHandler.handleError(error)
      logger.error('更新过程中发生错误', handledError)
      this.emitErrorUpdate(handledError)
    })
  }

  /**
   * 手动检查更新
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      if (this.currentStatus === 'checking') {
        logger.warn('正在检查更新中，跳过重复请求')
        return this.updateInfo
      }

      logger.info('手动检查更新')
      await autoUpdater.checkForUpdates()

      // 返回当前的更新信息（如果有的话）
      return this.updateInfo
    }
    catch (error) {
      logger.error('检查更新失败:', error)
      throw error
    }
  }

  /**
   * 下载更新
   */
  async downloadUpdate(): Promise<void> {
    try {
      if (this.currentStatus !== 'available') {
        throw new Error('没有可用的更新可供下载')
      }

      logger.info('开始下载更新')
      this.cancellationToken = new CancellationToken()
      await autoUpdater.downloadUpdate(this.cancellationToken!)
    }
    catch (error) {
      logger.error('下载更新失败:', error)
      throw error
    }
    finally {
      this.cancellationToken = null
    }
  }

  /**
   * 安装更新并重启应用
   */
  quitAndInstall(): void {
    try {
      if (this.currentStatus !== 'downloaded') {
        throw new Error('更新尚未下载完成')
      }

      logger.info('退出应用并安装更新')
      autoUpdater.quitAndInstall()
    }
    catch (error) {
      logger.error('安装更新失败:', error)
      throw error
    }
  }

  /**
   * 跳过当前版本的更新
   */
  skipVersion(): void {
    if (this.updateInfo) {
      this.configStore.setSkippedVersion(this.updateInfo.version)
      logger.info(`跳过版本 ${this.updateInfo.version}`)
      this.currentStatus = 'idle'
      this.updateInfo = null
      this.emitStatusUpdate()
    }
  }

  /**
   * 获取当前更新状态
   */
  getCurrentStatus(): UpdateStatus {
    return this.currentStatus
  }

  /**
   * 获取当前更新信息
   */
  getCurrentUpdateInfo(): UpdateInfo | null {
    return this.updateInfo
  }

  /**
   * 获取当前应用版本
   */
  getCurrentVersion(): string {
    return app.getVersion()
  }

  /**
   * 获取更新状态
   */
  getUpdateStatus(): UpdateStatus {
    return this.currentStatus
  }

  /**
   * 取消下载
   */
  cancelDownload(): void {
    try {
      if (this.currentStatus === 'downloading') {
        // electron-updater 没有直接的取消下载方法
        // 我们可以通过重置状态来模拟取消
        this.currentStatus = 'idle'
        this.updateInfo = null
        this.cancellationToken?.cancel()
        logger.info('已取消下载', this.cancellationToken)
      }
      else {
        logger.warn('当前没有正在进行的下载任务')
      }
    }
    catch (error) {
      logger.error('取消下载失败:', error)
      throw error
    }
  }

  /**
   * 获取更新配置
   */
  getConfig(): UpdateConfig {
    return this.configStore.getConfig()
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<UpdateConfig>): UpdateConfig {
    this.configStore.updateConfig(updates)

    // 如果更新了相关配置，重新配置 autoUpdater
    if (updates.includePrerelease !== undefined || updates.autoDownload !== undefined) {
      this.configureAutoUpdater()
    }

    const updatedConfig = this.configStore.getConfig()
    logger.info('更新配置已更新', updates)
    return updatedConfig
  }

  /**
   * 重置配置为默认值
   */
  resetConfig(): void {
    this.configStore.resetConfig()
    this.configureAutoUpdater()
    logger.info('更新配置已重置为默认值')
  }

  private getMainWindow() {
    if (this.mainWidnow === null) {
      logger.error('this.mainWidnow is null')
      throw new Error('this.mainWidnow is null')
    }
    return this.mainWidnow
  }

  /**
   * 发送状态更新事件
   */
  private emitStatusUpdate(): void {
    mainEmitter.send(this.getMainWindow().webContents, 'update:update-status-changed', {
      status: this.currentStatus,
      updateInfo: this.updateInfo,
    })
  }

  /**
   * 发送进度更新事件
   */
  private emitProgressUpdate(progress: ProgressInfo): void {
    mainEmitter.send(this.getMainWindow().webContents, 'update:download-progress', progress)
  }

  /**
   * 发送下载完成事件
   */
  private emitUpdateDownloaded(): void {
    mainEmitter.send(this.getMainWindow().webContents, 'update:update-downloaded', this.updateInfo!)
  }

  /**
   * 发送错误更新事件
   */
  private emitErrorUpdate(error: any): void {
    mainEmitter.send(this.getMainWindow().webContents, 'update:update-error', error)
  }

  /**
   * 清理资源
   */
  destroy(): void {
    // 移除所有事件监听器
    autoUpdater.removeAllListeners()
    this.isInitialized = false
    logger.info('更新服务已销毁')
  }
}
