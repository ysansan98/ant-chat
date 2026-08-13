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

/** 文件树中的一个条目（文件或目录）。relPath 为相对 workspacePath 的 posix 路径。 */
export interface WorkspaceTreeEntry {
  /** 条目名（basename） */
  name: string
  /** 相对 workspacePath 的 posix 路径；根目录下即为条目名 */
  relPath: string
  type: 'file' | 'directory'
}

/** 单个目录的懒加载列表：目录在前，文件在后，各自按名称排序。 */
export interface WorkspaceDirectoryEntries {
  dirs: WorkspaceTreeEntry[]
  files: WorkspaceTreeEntry[]
}

/** 文本文件预览结果。 */
export interface WorkspaceTextFileContent {
  content: string
  size: number
  /** binary 标记：由后端 NUL 嗅探判定，前端据此展示「该文件类型暂不支持预览」的中性提示 */
  binary?: boolean
  /** oversize 标记：文件超过单次预览上限（1MB），前端据此展示中性提示而非错误 */
  oversize?: boolean
}

/** 文件预览类型分类（决定前端分发到哪种预览组件）。 */
export type WorkspaceFileKind = 'image' | 'audio' | 'video' | 'excel' | 'pdf' | 'docx' | 'markdown' | 'text'

/** 流式预览文件元信息：已通过安全校验的真实路径与大小，供 HTTP/protocol 流式传输。 */
export interface WorkspaceFileStreamInfo {
  absolutePath: string
  size: number
  mediaType: string
}

export const WORKSPACE_INVALID_PATH = 'WORKSPACE_INVALID_PATH'
export const WORKSPACE_DUPLICATED_PATH = 'WORKSPACE_DUPLICATED_PATH'
