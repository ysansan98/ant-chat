import type { IpcResponse, ListWorkspacesData, WorkspaceDirectoryListing, WorkspaceFileSearchResult } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class WorkspaceIpcService extends IpcService {
  static readonly groupName = 'workspace'

  @IpcMethod()
  async listWorkspaces(): Promise<IpcResponse<ListWorkspacesData>> {
    return withIpcResponse(() => getAppRuntime().workspace.list(), '获取工作区列表失败')
  }

  @IpcMethod()
  async addWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    return withIpcResponse(() => getAppRuntime().workspace.add(path), '添加工作区失败')
  }

  @IpcMethod()
  async removeWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    return withIpcResponse(() => getAppRuntime().workspace.remove(path), '删除工作区失败')
  }

  @IpcMethod()
  async openWorkspace(path: string): Promise<IpcResponse<ListWorkspacesData>> {
    return withIpcResponse(() => getAppRuntime().workspace.open(path), '切换工作区失败')
  }

  @IpcMethod()
  async listDirectories(path?: string): Promise<IpcResponse<WorkspaceDirectoryListing>> {
    return withIpcResponse(() => getAppRuntime().workspace.listDirectories(path), '获取目录列表失败')
  }

  @IpcMethod()
  async createDirectory(parentPath: string, name: string): Promise<IpcResponse<{ name: string, path: string }>> {
    return withIpcResponse(() => getAppRuntime().workspace.createDirectory(parentPath, name), '创建目录失败')
  }

  @IpcMethod()
  async searchWorkspaceFiles(query = '', limit = 50): Promise<IpcResponse<WorkspaceFileSearchResult[]>> {
    return withIpcResponse(() => getAppRuntime().workspace.searchFiles(query, limit), '搜索工作区文件失败')
  }
}
