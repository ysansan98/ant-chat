import type { BrowserIdentityStatus, IpcResponse } from '@ant-chat/shared'
import { BrowserProfilesModule } from '@ant-chat/backend'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { getMainWindow } from '@main/windows/window'
import { dialog } from 'electron'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class BrowserProfilesIpcService extends IpcService {
  static readonly groupName = 'browserProfiles'

  @IpcMethod()
  async importFromDirectory(): Promise<IpcResponse<BrowserIdentityStatus | null>> {
    return withIpcResponse(async () => {
      const mainWindow = getMainWindow()
      if (!mainWindow)
        throw new Error('Main window is not created yet')
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择浏览器 Profile 目录',
      })
      if (result.canceled || result.filePaths.length === 0)
        return null
      return getAppRuntime().getModule(BrowserProfilesModule).importFromDirectory(result.filePaths[0])
    }, '导入浏览器 Cookies 失败')
  }
}
