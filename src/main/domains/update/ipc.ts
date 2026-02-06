import type { IpcResponse, UpdateConfig, UpdateInfo, UpdateStatus } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { UpdateService } from '@main/domains/update/updateService'
import { UpdateConfigStore } from '@main/store/updateSettings'
import { logger } from '@main/utils/logger'
import { UpdateErrorHandler } from '@main/utils/updateErrorHandler'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class UpdateIpcService extends IpcService {
  static readonly groupName = 'update'

  private readonly updateService = UpdateService.getInstance()
  private readonly updateConfigStore = UpdateConfigStore.getInstance()

  @IpcMethod()
  async getCurrentVersion(): Promise<IpcResponse<string>> {
    try {
      const version = this.updateService.getCurrentVersion()
      return createIpcResponse(true, version)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async checkForUpdatesManual(): Promise<IpcResponse<UpdateInfo | null>> {
    try {
      const updateInfo = await this.updateService.checkForUpdates()
      return createIpcResponse(true, updateInfo)
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '手动检查更新')
      logger.error('手动检查更新失败:', updateError)
      return createErrorIpcResponse(updateError.userMessage)
    }
  }

  @IpcMethod()
  async getUpdateConfig(): Promise<IpcResponse<UpdateConfig>> {
    try {
      const config = this.updateConfigStore.getConfig()
      return createIpcResponse(true, config)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async setUpdateConfig(config: UpdateConfig): Promise<IpcResponse<UpdateConfig>> {
    try {
      const updatedConfig = this.updateService.updateConfig(config)
      return createIpcResponse(true, updatedConfig)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async downloadUpdate(): Promise<IpcResponse<null>> {
    try {
      await this.updateService.downloadUpdate()
      return createIpcResponse(true, null)
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '下载更新')
      logger.error('下载更新失败:', updateError)
      return createErrorIpcResponse(updateError.userMessage)
    }
  }

  @IpcMethod()
  async getUpdateStatus(): Promise<IpcResponse<UpdateStatus>> {
    try {
      const status = this.updateService.getUpdateStatus()
      return createIpcResponse(true, status)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async checkForUpdates(): Promise<void> {
    try {
      await this.updateService.checkForUpdates()
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '自动检查更新')
      logger.error('自动检查更新失败:', updateError)
    }
  }

  @IpcMethod()
  async quitAndInstall(): Promise<void> {
    try {
      this.updateService.quitAndInstall()
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '退出并安装')
      logger.error('退出并安装失败:', updateError)
    }
  }

  @IpcMethod()
  async cancelDownload(): Promise<void> {
    try {
      this.updateService.cancelDownload()
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '取消下载')
      logger.error('取消下载失败:', updateError)
    }
  }
}
