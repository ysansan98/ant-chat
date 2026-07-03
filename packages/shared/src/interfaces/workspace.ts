export interface WorkspaceConfig {
  workspaces: Array<{
    path: string
    addedAt: number
    lastOpenedAt?: number
  }>
}

export interface WorkspaceItem {
  path: string
  displayName: string
  isDefault: boolean
  lastOpenedAt?: number
}

export interface ListWorkspacesData {
  workspaces: WorkspaceItem[]
}

export interface WorkspaceFileSearchResult {
  /** 相对于 workspacePath 的 posix 路径 */
  path: string
  /** basename */
  name: string
  /** file = 普通文件；directory = 目录（用于 @ 引用的路径补全钻取） */
  type: 'file' | 'directory'
}

export interface WorkspaceDirectoryEntry {
  name: string
  path: string
}

export interface WorkspaceDirectoryListing {
  currentPath: string
  parentPath: string | null
  roots: string[]
  directories: WorkspaceDirectoryEntry[]
}

export const WORKSPACE_INVALID_PATH = 'WORKSPACE_INVALID_PATH'
export const WORKSPACE_DUPLICATED_PATH = 'WORKSPACE_DUPLICATED_PATH'
