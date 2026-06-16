import type { IpcResponse, UpdateConfig, UpdateInfo, UpdateStatus } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { UpdateService } from '@main/domains/update/updateService'
import { UpdateConfigStore } from '@main/store/updateSettings'
import { withIpcResponse } from '@main/utils/ipc-response'
import { logger } from '@main/utils/logger'
import { UpdateErrorHandler } from '@main/utils/updateErrorHandler'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class UpdateIpcService extends IpcService {
  static readonly groupName = 'update'

  private readonly updateService = UpdateService.getInstance()
  private readonly updateConfigStore = UpdateConfigStore.getInstance()

  @IpcMethod()
  async getCurrentVersion(): Promise<IpcResponse<string>> {
    return withIpcResponse(() => this.updateService.getCurrentVersion(), '获取当前版本失败')
  }

  // 更新流程的失败需经 UpdateErrorHandler 转成用户可读信息，不走通用包装器。
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
    return withIpcResponse(() => this.updateConfigStore.getConfig(), '获取更新配置失败')
  }

  @IpcMethod()
  async setUpdateConfig(config: UpdateConfig): Promise<IpcResponse<UpdateConfig>> {
    return withIpcResponse(() => this.updateService.updateConfig(config), '保存更新配置失败')
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
    return withIpcResponse(() => this.updateService.getUpdateStatus(), '获取更新状态失败')
  }

  // 以下为内部触发的操作，无返回体，失败仅记录日志。
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
