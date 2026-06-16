import type { GeneralSettingsState, IpcResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { openSettingsWindow } from '@main/windows/settings-window'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class SettingsIpcService extends IpcService {
  static readonly groupName = 'settings'

  @IpcMethod()
  async openSettingsWindow(): Promise<IpcResponse<void>> {
    return withIpcResponse(() => openSettingsWindow(), '打开设置窗口失败')
  }

  @IpcMethod()
  async getSettings(): Promise<IpcResponse<GeneralSettingsState>> {
    return withIpcResponse(() => getAppRuntime().settings.get(), '获取设置失败')
  }

  @IpcMethod()
  async updateSettings(updates: Partial<GeneralSettingsState>): Promise<IpcResponse<GeneralSettingsState>> {
    return withIpcResponse(() => getAppRuntime().settings.update(updates), '更新设置失败')
  }

  @IpcMethod()
  async resetSettings(): Promise<IpcResponse<GeneralSettingsState>> {
    return withIpcResponse(() => getAppRuntime().settings.reset(), '重置设置失败')
  }

  @IpcMethod()
  async testProxyConnection(proxyUrl: string): Promise<IpcResponse<boolean>> {
    return withIpcResponse(() => getAppRuntime().settings.testProxy(proxyUrl), '代理连接测试失败')
  }
}
