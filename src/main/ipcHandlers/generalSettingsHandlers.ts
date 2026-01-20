import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { mainListener } from '@main/utils/ipc-events-bus'
import { ProxyManager } from '@main/utils/proxy-manager'
import { GeneralSettingsStore } from '../store/generalSettings'

export function registerGeneralSettingsHandlers() {
  mainListener.handle('general-settings:get-settings', async () => {
    try {
      const settings = GeneralSettingsStore.getInstance().getSettings()
      return createIpcResponse(true, settings)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  })

  mainListener.handle('general-settings:update-settings', async (_, updates) => {
    try {
      const store = GeneralSettingsStore.getInstance()
      store.updateSettings(updates)
      const updatedSettings = store.getSettings()

      // 如果更新了代理设置，同步更新 ProxyManager
      if (updates.proxySettings) {
        await ProxyManager.getInstance().updateProxySettings(updates.proxySettings)
      }

      return createIpcResponse(true, updatedSettings)
    }
    catch (error) {
      console.error('Failed to update general settings:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  })

  mainListener.handle('general-settings:reset-settings', async () => {
    try {
      const store = GeneralSettingsStore.getInstance()
      store.resetSettings()
      const settings = store.getSettings()

      // 重置设置后，同步更新 ProxyManager
      await ProxyManager.getInstance().updateProxySettings(settings.proxySettings)

      return createIpcResponse(true, settings)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  })
}
