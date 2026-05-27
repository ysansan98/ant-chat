import type { IpcResponse, ListWorkspacesData, WorkspaceFileSearchResult } from '@ant-chat/shared'
import { searchWorkspaceFiles } from '@ant-chat/app-data'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { sendToRenderer } from '@main/utils/ipc-events'
import { logger } from '@main/utils/logger'
import { getMainWindow } from '@main/window'
import { dialog } from 'electron'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class WorkspaceIpcService extends IpcService {
  static readonly groupName = 'workspace'

  @IpcMethod()
  async listWorkspaces(): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      return createIpcResponse(true, getAppDataServices().workspaceService.listWorkspaces())
    }
    catch (error) {
      logger.error('获取工作区列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      const result = getAppDataServices().workspaceService.addWorkspace(path)
      this.emitWorkspaceChanged(result.currentWorkspacePath)
      return createIpcResponse(true, result)
    }
    catch (error) {
      logger.error('添加工作区失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async removeWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      const result = getAppDataServices().workspaceService.removeWorkspace(path)
      this.emitWorkspaceChanged(result.currentWorkspacePath)
      return createIpcResponse(true, result)
    }
    catch (error) {
      logger.error('删除工作区失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async openWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      const result = getAppDataServices().workspaceService.openWorkspace(path)
      this.emitWorkspaceChanged(result.currentWorkspacePath)
      return createIpcResponse(true, result)
    }
    catch (error) {
      logger.error('切换工作区失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async chooseWorkspace(): Promise<IpcResponse<ListWorkspacesData | null>> {
    try {
      const mainWindow = getMainWindow()
      if (!mainWindow) {
        throw new Error('Main window is not created yet')
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: '选择工作区',
      })

      if (result.canceled || result.filePaths.length === 0) {
        return createIpcResponse(true, null)
      }

      const data = getAppDataServices().workspaceService.addWorkspace(result.filePaths[0])
      this.emitWorkspaceChanged(data.currentWorkspacePath)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('选择工作区失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async searchWorkspaceFiles(query = '', limit = 50): Promise<IpcResponse<WorkspaceFileSearchResult[]>> {
    try {
      const workspacePath = getAppDataServices().workspaceService.getCurrentWorkspacePath()
      if (!workspacePath) {
        return createIpcResponse(true, [])
      }

      return createIpcResponse(true, await searchWorkspaceFiles(workspacePath, query, limit))
    }
    catch (error) {
      logger.error('搜索工作区文件失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  private emitWorkspaceChanged(currentWorkspacePath: string): void {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      sendToRenderer(mainWindow.webContents, 'workspace:changed', { currentWorkspacePath })
    }
  }
}
