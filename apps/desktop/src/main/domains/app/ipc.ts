import type { ElectronData } from '@ant-chat/shared'
import type { Rectangle } from 'electron'
import { isWindows } from '@main/utils/env'
import { clipboardWrite } from '@main/utils/util'
import { getMainWindow } from '@main/windows/window'
import { app } from 'electron'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class AppIpcService extends IpcService {
  static readonly groupName = 'app'

  private previousBounds: Rectangle | null = null

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
