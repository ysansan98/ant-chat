import type {
  ListWorkspacesData,
  WorkspaceDirectoryEntries,
  WorkspaceDirectoryListing,
  WorkspaceFileSearchResult,
  WorkspaceTextFileContent,
} from '@ant-chat/shared'
import { isElectronRuntime } from '@/utils/ipc-bus'
import { getAppRpcClient } from './transports/appRpc'

async function listWorkspaces(): Promise<ListWorkspacesData> {
  return getAppRpcClient().call('workspace.listWorkspaces', undefined)
}

async function addWorkspace(path: string): Promise<ListWorkspacesData> {
  return getAppRpcClient().call('workspace.addWorkspace', { path })
}

async function removeWorkspace(path: string, deletePermissionGroup: boolean): Promise<ListWorkspacesData> {
  return getAppRpcClient().call('workspace.removeWorkspace', { path, deletePermissionGroup })
}

async function openWorkspace(path: string): Promise<ListWorkspacesData> {
  return getAppRpcClient().call('workspace.openWorkspace', { path })
}

async function reorderWorkspaces(paths: string[]): Promise<ListWorkspacesData> {
  return getAppRpcClient().call('workspace.reorderWorkspaces', { paths })
}

async function chooseWorkspace(): Promise<ListWorkspacesData | null> {
  return null
}

async function listDirectories(path?: string): Promise<WorkspaceDirectoryListing> {
  return getAppRpcClient().call('workspace.listDirectories', { path })
}

async function createDirectory(parentPath: string, name: string): Promise<{ name: string, path: string }> {
  return getAppRpcClient().call('workspace.createDirectory', { parentPath, name })
}

async function searchWorkspaceFiles(workspacePath: string, query: string, limit = 50): Promise<WorkspaceFileSearchResult[]> {
  return getAppRpcClient().call('workspace.searchWorkspaceFiles', { workspacePath, query, limit })
}

async function listDirectoryEntries(workspacePath: string, relPath?: string): Promise<WorkspaceDirectoryEntries> {
  return getAppRpcClient().call('workspace.listDirectoryEntries', { workspacePath, relPath })
}

async function readTextFile(workspacePath: string, relPath: string): Promise<WorkspaceTextFileContent> {
  return getAppRpcClient().call('workspace.readTextFile', { workspacePath, relPath })
}

async function openWithDefaultApp(workspacePath: string, relPath: string): Promise<void> {
  return getAppRpcClient().call('workspace.openWithDefaultApp', { workspacePath, relPath })
}

/**
 * 构造工作区文件的流式预览 URL。
 * - Web：走本地 HTTP 端点 /api/workspace/file（支持 Range）。
 * - Electron：走自定义 scheme antchat-ws-file（protocol.handle 流式 + Range）。
 * 安全校验由后端 workspace.resolveFileForStream 统一完成。
 */
function getFileStreamUrl(workspacePath: string, relPath: string): string {
  const params = new URLSearchParams({ workspacePath, relPath })
  return isElectronRuntime()
    ? `antchat-ws-file://file?${params.toString()}`
    : `/api/workspace/file?${params.toString()}`
}

export default {
  listWorkspaces,
  addWorkspace,
  removeWorkspace,
  openWorkspace,
  reorderWorkspaces,
  chooseWorkspace,
  listDirectories,
  createDirectory,
  searchWorkspaceFiles,
  listDirectoryEntries,
  readTextFile,
  openWithDefaultApp,
  getFileStreamUrl,
}
