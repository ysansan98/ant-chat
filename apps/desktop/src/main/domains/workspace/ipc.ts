import type { IpcResponse, ListWorkspacesData, WorkspaceDirectoryListing, WorkspaceFileSearchResult } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/runtime/appRuntime'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class WorkspaceIpcService extends IpcService {
  static readonly groupName = 'workspace'

  @IpcMethod()
  async listWorkspaces(): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      return createIpcResponse(true, getAppRuntime().workspace.list())
    }
    catch (error) {
      logger.error('获取工作区列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      return createIpcResponse(true, getAppRuntime().workspace.add(path))
    }
    catch (error) {
      logger.error('添加工作区失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async removeWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      return createIpcResponse(true, getAppRuntime().workspace.remove(path))
    }
    catch (error) {
      logger.error('删除工作区失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async openWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    try {
      return createIpcResponse(true, getAppRuntime().workspace.open(path))
    }
    catch (error) {
      logger.error('切换工作区失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async listDirectories(path?: string): Promise<IpcResponse<WorkspaceDirectoryListing>> {
    try {
      return createIpcResponse(true, getAppRuntime().workspace.listDirectories(path))
    }
    catch (error) {
      logger.error('获取目录列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async createDirectory(parentPath: string, name: string): Promise<IpcResponse<{ name: string, path: string }>> {
    try {
      return createIpcResponse(true, getAppRuntime().workspace.createDirectory(parentPath, name))
    }
    catch (error) {
      logger.error('创建目录失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async searchWorkspaceFiles(query = '', limit = 50): Promise<IpcResponse<WorkspaceFileSearchResult[]>> {
    try {
      return createIpcResponse(true, await getAppRuntime().workspace.searchFiles(query, limit))
    }
    catch (error) {
      logger.error('搜索工作区文件失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }
}
