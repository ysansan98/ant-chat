import type { GeneralSettingsState, IpcResponse } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { GeneralSettingsStore } from '@main/store/generalSettings'
import { logger } from '@main/utils/logger'
import { ProxyManager } from '@main/utils/proxy-manager'
import { testProxyConnection } from '@main/utils/system-proxy'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class SettingsIpcService extends IpcService {
  static readonly groupName = 'settings'

  @IpcMethod()
  async getSettings(): Promise<IpcResponse<GeneralSettingsState>> {
    try {
      const settings = GeneralSettingsStore.getInstance().getSettings()
      return createIpcResponse(true, settings)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async updateSettings(updates: Partial<GeneralSettingsState>): Promise<IpcResponse<GeneralSettingsState>> {
    try {
      const store = GeneralSettingsStore.getInstance()
      store.updateSettings(updates)
      const updatedSettings = store.getSettings()

      if (updates.proxySettings) {
        await ProxyManager.getInstance().updateProxySettings(updates.proxySettings)
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
      const store = GeneralSettingsStore.getInstance()
      store.resetSettings()
      const settings = store.getSettings()

      await ProxyManager.getInstance().updateProxySettings(settings.proxySettings)

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
