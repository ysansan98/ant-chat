import type { IpcResponse, ListWorkspacesData, WorkspaceDirectoryListing, WorkspaceFileSearchResult } from '@ant-chat/shared'
import { searchWorkspaceFiles } from '@ant-chat/app-data'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'
import { sendToRenderer } from '@main/utils/ipc-events'
import { logger } from '@main/utils/logger'
import { getMainWindow } from '@main/windows/window'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class WorkspaceIpcService extends IpcService {
  static readonly groupName = 'workspace'

  @IpcMethod()
  async listWorkspaces(): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      return createIpcResponse(true, getAgentRuntimeEnvironment().appDataContext.workspaceService.listWorkspaces())
    }
    catch (error) {
      logger.error('获取工作区列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      const result = getAgentRuntimeEnvironment().appDataContext.workspaceService.addWorkspace(path)
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
      const result = getAgentRuntimeEnvironment().appDataContext.workspaceService.removeWorkspace(path)
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
      const result = getAgentRuntimeEnvironment().appDataContext.workspaceService.openWorkspace(path)
      this.emitWorkspaceChanged(result.currentWorkspacePath)
      return createIpcResponse(true, result)
    }
    catch (error) {
      logger.error('切换工作区失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async listDirectories(path?: string): Promise<IpcResponse<WorkspaceDirectoryListing>> {
    try {
      return createIpcResponse(true, getAgentRuntimeEnvironment().appDataContext.workspaceService.listDirectories(path))
    }
    catch (error) {
      logger.error('获取目录列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async createDirectory(parentPath: string, name: string): Promise<IpcResponse<{ name: string, path: string }>> {
    try {
      return createIpcResponse(true, getAgentRuntimeEnvironment().appDataContext.workspaceService.createDirectory(parentPath, name))
    }
    catch (error) {
      logger.error('创建目录失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async searchWorkspaceFiles(query = '', limit = 50): Promise<IpcResponse<WorkspaceFileSearchResult[]>> {
    try {
      const workspacePath = getAgentRuntimeEnvironment().appDataContext.workspaceService.getCurrentWorkspacePath()
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
