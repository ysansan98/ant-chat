import type { IpcResponse, SkillManifest } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { getMainWindow } from '@main/windows/window'
import { dialog } from 'electron'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class SkillsIpcService extends IpcService {
  static readonly groupName = 'skills'

  @IpcMethod()
  async importSkillFromZip(): Promise<IpcResponse<SkillManifest | null>> {
    // dialog 交互整体交给包装器，用户取消时返回 null 属正常结果而非错误。
    return withIpcResponse(async () => {
      const mainWindow = getMainWindow()
      if (!mainWindow) {
        throw new Error('Main window is not created yet')
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: '导入 Skill ZIP',
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return getAppRuntime().skills.importZip(result.filePaths[0])
    }, '导入 Skill ZIP 失败')
  }
}
