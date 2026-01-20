import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { UpdateService } from '@main/services/UpdateService'
import { UpdateConfigStore } from '@main/store/updateSettings'
import { mainListener } from '@main/utils/ipc-events-bus'
import { logger } from '@main/utils/logger'
import { UpdateErrorHandler } from '@main/utils/updateErrorHandler'

export function registerUpdateHandlers() {
  const updateService = UpdateService.getInstance()
  const updateConfigStore = UpdateConfigStore.getInstance()

  // 获取当前版本
  mainListener.handle('update:get-current-version', async () => {
    try {
      const version = updateService.getCurrentVersion()
      return createIpcResponse(true, version)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  })

  // 手动检查更新
  mainListener.handle('update:check-for-updates-manual', async () => {
    try {
      const updateInfo = await updateService.checkForUpdates()
      return createIpcResponse(true, updateInfo)
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '手动检查更新')
      logger.error('手动检查更新失败:', updateError)
      return createErrorIpcResponse(updateError.userMessage)
    }
  })

  // 获取更新配置
  mainListener.handle('update:get-update-config', async () => {
    try {
      const config = updateConfigStore.getConfig()
      return createIpcResponse(true, config)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  })

  // 设置更新配置
  mainListener.handle('update:set-update-config', async (_, config) => {
    try {
      const updatedConfig = updateService.updateConfig(config)
      return createIpcResponse(true, updatedConfig)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  })

  // 下载更新
  mainListener.handle('update:download-update', async () => {
    try {
      await updateService.downloadUpdate()
      return createIpcResponse(true, null)
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '下载更新')
      logger.error('下载更新失败:', updateError)
      return createErrorIpcResponse(updateError.userMessage)
    }
  })

  // 获取更新状态
  mainListener.handle('update:get-update-status', async () => {
    try {
      const status = updateService.getUpdateStatus()
      return createIpcResponse(true, status)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  })

  // 检查更新（自动触发）
  mainListener.on('update:check-for-updates', async () => {
    try {
      await updateService.checkForUpdates()
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '自动检查更新')
      logger.error('自动检查更新失败:', updateError)
    }
  })

  // 退出并安装更新
  mainListener.on('update:quit-and-install', async () => {
    try {
      updateService.quitAndInstall()
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '退出并安装')
      logger.error('退出并安装失败:', updateError)
    }
  })

  // 取消下载
  mainListener.on('update:cancel-download', async () => {
    try {
      updateService.cancelDownload()
    }
    catch (error) {
      const updateError = UpdateErrorHandler.handleError(error, '取消下载')
      logger.error('取消下载失败:', updateError)
    }
  })
}
