import type { ImportSkillFromGithubOptions, IpcResponse, SetSkillEnabledOptions, SkillIndex, SkillManifest } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/runtime/appRuntime'
import { logger } from '@main/utils/logger'
import { getMainWindow } from '@main/windows/window'
import { dialog } from 'electron'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class SkillsIpcService extends IpcService {
  static readonly groupName = 'skills'

  @IpcMethod()
  async listSkills(): Promise<IpcResponse<SkillIndex>> {
    try {
      return createIpcResponse(true, await getAppRuntime().skills.list())
    }
    catch (error) {
      logger.error('获取 Skill 列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async importSkillFromZip(): Promise<IpcResponse<SkillManifest | null>> {
    try {
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
        return createIpcResponse(true, null)
      }
      return createIpcResponse(true, await getAppRuntime().skills.importZip(result.filePaths[0]))
    }
    catch (error) {
      logger.error('导入 Skill ZIP 失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async importSkillFromGithub(options: ImportSkillFromGithubOptions): Promise<IpcResponse<SkillManifest>> {
    try {
      return createIpcResponse(true, await getAppRuntime().skills.importGithub(options))
    }
    catch (error) {
      logger.error('从 GitHub 导入 Skill 失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async setSkillEnabled(options: SetSkillEnabledOptions): Promise<IpcResponse<SkillManifest>> {
    try {
      return createIpcResponse(true, await getAppRuntime().skills.setEnabled(options))
    }
    catch (error) {
      logger.error('更新 Skill 启用状态失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteSkill(name: string): Promise<IpcResponse<null>> {
    try {
      await getAppRuntime().skills.delete(name)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除 Skill 失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async rebuildSkillIndex(): Promise<IpcResponse<SkillIndex>> {
    try {
      return createIpcResponse(true, await getAppRuntime().skills.rebuildIndex())
    }
    catch (error) {
      logger.error('重建 Skill 索引失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }
}
