import type { GeneralSettingsState, IpcResponse } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/runtime/appRuntime'
import { logger } from '@main/utils/logger'
import { openSettingsWindow } from '@main/windows/settings-window'
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
      const settings = await getAppRuntime().settings.get()
      return createIpcResponse(true, settings)
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async updateSettings(updates: Partial<GeneralSettingsState>): Promise<IpcResponse<GeneralSettingsState>> {
    try {
      return createIpcResponse(true, await getAppRuntime().settings.update(updates))
    }
    catch (error) {
      console.error('Failed to update general settings:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async resetSettings(): Promise<IpcResponse<GeneralSettingsState>> {
    try {
      return createIpcResponse(true, await getAppRuntime().settings.reset())
    }
    catch (error) {
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async testProxyConnection(proxyUrl: string): Promise<IpcResponse<boolean>> {
    try {
      const success = await getAppRuntime().settings.testProxy(proxyUrl)
      return createIpcResponse(true, success)
    }
    catch (error) {
      logger.error('Proxy test failed:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }
}
