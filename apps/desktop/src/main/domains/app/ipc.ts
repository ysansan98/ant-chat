import type { ElectronData } from '@ant-chat/shared'
import type { Rectangle } from 'electron'
import { isWindows } from '@main/utils/env'
import { clipboardWrite } from '@main/utils/util'
import { getSettingsWindow } from '@main/windows/settings-window'
import { getMainWindow } from '@main/windows/window'
import { app } from 'electron'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class AppIpcService extends IpcService {
  static readonly groupName = 'app'

  private previousBounds: Rectangle | null = null

  @IpcMethod()
  async focusMainWindow(): Promise<void> {
    const window = getMainWindow()
    if (window?.isMinimized()) {
      window.restore()
    }
    window?.focus()
    // 设置窗口触发「返回工作区」时，关闭自身；非设置窗口调用时 getSettingsWindow() 为 null，安全无副作用。
    getSettingsWindow()?.close()
  }

  @IpcMethod()
  async clipboardWrite(data: ElectronData, type?: 'selection' | 'clipboard'): Promise<boolean> {
    return clipboardWrite(data as Electron.Data, type)
  }

  @IpcMethod()
  async minimizeWindow(): Promise<void> {
    const window = getMainWindow()
    window?.minimize()
  }

  @IpcMethod()
  async maximizeOrRestoreWindow(): Promise<void> {
    const window = getMainWindow()
    if (!window) {
      return
    }

    const isMaximized = window.isMaximized()
    if (isMaximized) {
      if (isWindows) {
        window.restore()
      }
      else if (this.previousBounds) {
        window.setBounds(this.previousBounds)
      }
    }
    else {
      this.previousBounds = window.getBounds()
      window.maximize()
    }
  }

  @IpcMethod()
  async quitApp(): Promise<void> {
    app.quit()
  }
}
