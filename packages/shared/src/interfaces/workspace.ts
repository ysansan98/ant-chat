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
