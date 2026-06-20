import type { ListWorkspacesData, WorkspaceDirectoryListing, WorkspaceFileSearchResult } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

async function listWorkspaces(): Promise<ListWorkspacesData> {
  return getAppRpcClient().call('workspace.listWorkspaces', undefined)
}

async function addWorkspace(path: string): Promise<ListWorkspacesData> {
  return getAppRpcClient().call('workspace.addWorkspace', { path })
}

async function removeWorkspace(path: string): Promise<ListWorkspacesData> {
  return getAppRpcClient().call('workspace.removeWorkspace', { path })
}

async function openWorkspace(path: string): Promise<ListWorkspacesData> {
  return getAppRpcClient().call('workspace.openWorkspace', { path })
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

async function searchWorkspaceFiles(query: string, limit = 50): Promise<WorkspaceFileSearchResult[]> {
  return getAppRpcClient().call('workspace.searchWorkspaceFiles', { query, limit })
}

export default {
  listWorkspaces,
  addWorkspace,
  removeWorkspace,
  openWorkspace,
  chooseWorkspace,
  listDirectories,
  createDirectory,
  searchWorkspaceFiles,
}
