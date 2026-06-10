export interface WorkspaceConfig {
  currentWorkspacePath?: string
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
  currentWorkspacePath: string
  workspaces: WorkspaceItem[]
}

export interface WorkspaceFileSearchResult {
  path: string
  name: string
  type: 'file'
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
