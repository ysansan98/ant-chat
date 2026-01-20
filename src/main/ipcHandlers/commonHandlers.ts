import type { BrowserWindow } from 'electron'
import { isWindows } from '@main/utils/env'
import { app } from 'electron'
import { mainListener } from '../utils/ipc-events-bus'
import { clipboardWrite } from '../utils/util'

export function registerCommonHandlers(mainWindow: BrowserWindow) {
  mainListener.handle('common:clipboard-write', async (_, text) => {
    return clipboardWrite(text)
  })

  mainListener.on('common:minimize-window', async () => {
    return mainWindow.minimize()
  })

  // 保存窗口大小和位置
  let previousBounds: Electron.Rectangle

  mainListener.on('common:maximize-or-resore-window', async () => {
    const flag = mainWindow.isMaximized()
    console.log('isMaximized', flag, previousBounds)
    if (flag) {
      if (isWindows) {
        mainWindow.restore()
      }
      else {
        // macos 不支持restore，直接设置之前的大小和位置
        mainWindow.setBounds(previousBounds)
      }
    }
    else {
      previousBounds = mainWindow.getBounds()
      mainWindow.maximize()
    }
  })

  mainListener.on('common:quit-app', async () => {
    app.quit()
  })
}
