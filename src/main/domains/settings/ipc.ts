import type { GeneralSettingsState, IpcResponse } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { getSettingsWindow, openSettingsWindow } from '@main/settings-window'
import { logger } from '@main/utils/logger'
import { ProxyManager } from '@main/utils/proxy-manager'
import { testProxyConnection } from '@main/utils/system-proxy'
import { getMainWindow } from '@main/window'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class SettingsIpcService extends IpcService {
  static readonly groupName = 'settings'

  @IpcMethod()
  async openSettingsWindow(): Promise<IpcResponse<void>> {
    try {
      await openSettingsWindow()
      return createIpcResponse(true, undefined)
    }
    catch (error) {
      logger.error('Failed to open settings window:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async getSettings(): Promise<IpcResponse<GeneralSettingsState>> {
    try {
      const settings = await getAppDataServices().settingsService.getGeneralSettings()
      return createIpcResponse(true, settings)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async updateSettings(updates: Partial<GeneralSettingsState>): Promise<IpcResponse<GeneralSettingsState>> {
    try {
      const updatedSettings = await getAppDataServices().settingsService.updateGeneralSettings(updates)

      if (updates.proxySettings) {
        await ProxyManager.getInstance().updateProxySettings(updates.proxySettings)
      }

      // 广播 settings:updated 事件
      const mainWindow = getMainWindow()
      const settingsWindow = getSettingsWindow()
      const keys = Object.keys(updates)

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('settings:updated', { keys })
      }
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('settings:updated', { keys })
      }

      return createIpcResponse(true, updatedSettings)
    }
    catch (error) {
      console.error('Failed to update general settings:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async resetSettings(): Promise<IpcResponse<GeneralSettingsState>> {
    try {
      const settings = await getAppDataServices().settingsService.resetGeneralSettings()

      await ProxyManager.getInstance().updateProxySettings(settings.proxySettings)

      // 广播 settings:updated 事件
      const mainWindow = getMainWindow()
      const settingsWindow = getSettingsWindow()

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('settings:updated', { keys: ['all'] })
      }
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('settings:updated', { keys: ['all'] })
      }

      return createIpcResponse(true, settings)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async testProxyConnection(proxyUrl: string): Promise<IpcResponse<boolean>> {
    try {
      const success = await testProxyConnection(proxyUrl)
      return createIpcResponse(true, success)
    }
    catch (error) {
      logger.error('Proxy test failed:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }
}
