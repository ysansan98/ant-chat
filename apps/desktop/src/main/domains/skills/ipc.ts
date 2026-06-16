import type { ImportSkillFromGithubOptions, IpcResponse, SetSkillEnabledOptions, SkillIndex, SkillManifest } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { getMainWindow } from '@main/windows/window'
import { dialog } from 'electron'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class SkillsIpcService extends IpcService {
  static readonly groupName = 'skills'

  @IpcMethod()
  async listSkills(): Promise<IpcResponse<SkillIndex>> {
    return withIpcResponse(() => getAppRuntime().skills.list(), '获取 Skill 列表失败')
  }

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

  @IpcMethod()
  async importSkillFromGithub(options: ImportSkillFromGithubOptions): Promise<IpcResponse<SkillManifest>> {
    return withIpcResponse(() => getAppRuntime().skills.importGithub(options), '从 GitHub 导入 Skill 失败')
  }

  @IpcMethod()
  async setSkillEnabled(options: SetSkillEnabledOptions): Promise<IpcResponse<SkillManifest>> {
    return withIpcResponse(() => getAppRuntime().skills.setEnabled(options), '更新 Skill 启用状态失败')
  }

  @IpcMethod()
  async deleteSkill(name: string): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().skills.delete(name), '删除 Skill 失败')
  }

  @IpcMethod()
  async rebuildSkillIndex(): Promise<IpcResponse<SkillIndex>> {
    return withIpcResponse(() => getAppRuntime().skills.rebuildIndex(), '重建 Skill 索引失败')
  }
}
