import type { IpcResponse } from '@ant-chat/shared'
import { withIpcResponse } from '@main/utils/ipc-response'
import { openSettingsWindow } from '@main/windows/settings-window'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class SettingsIpcService extends IpcService {
  static readonly groupName = 'settings'

  @IpcMethod()
  async openSettingsWindow(): Promise<IpcResponse<void>> {
    return withIpcResponse(() => openSettingsWindow(), '打开设置窗口失败')
  }
}
