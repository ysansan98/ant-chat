import type { ListWorkspacesData, WorkspaceConfig, WorkspaceDirectoryEntry, WorkspaceDirectoryListing, WorkspaceItem } from '@ant-chat/shared'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { WORKSPACE_DUPLICATED_PATH, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'
import { AtomicJsonFileStore } from '../file'

export interface WorkspaceServiceOptions {
  filePath: string
  initialConfig?: WorkspaceConfig
  resetInvalidFile?: boolean
}

const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = { workspaces: [] }

export class WorkspaceService {
  private readonly store: AtomicJsonFileStore<WorkspaceConfig>

  constructor(private readonly options: WorkspaceServiceOptions) {
    this.store = new AtomicJsonFileStore(options.filePath)
    if (!this.store.exists()) {
      this.saveConfig(options.initialConfig ?? DEFAULT_WORKSPACE_CONFIG)
      return
    }

    if (options.resetInvalidFile) {
      try {
        this.parseConfig(this.store.read())
      }
      catch {
        this.saveConfig(options.initialConfig ?? DEFAULT_WORKSPACE_CONFIG)
      }
    }
  }

  getDefaultWorkspacePath(): string {
    return path.normalize(path.join(os.homedir(), 'antChatProject'))
  }

  ensureInitialized(): WorkspaceConfig {
    fs.mkdirSync(this.getDefaultWorkspacePath(), { recursive: true })
    const defaultPath = this.normalizeExistingDirectory(this.getDefaultWorkspacePath())

    const current = this.getConfig()
    const normalizedWorkspaces = current.workspaces
      .map((item) => {
        try {
          return {
            ...item,
            path: this.normalizeExistingDirectory(item.path),
          }
        }
        catch {
          return null
        }
      })
      .filter(item => item !== null)

    const existsDefault = normalizedWorkspaces.some(item => item.path === defaultPath)
    const workspaces = existsDefault
      ? normalizedWorkspaces
      : [{ path: defaultPath, addedAt: Date.now(), lastOpenedAt: Date.now() }, ...normalizedWorkspaces]

    const next = { workspaces: this.dedupeWorkspaces(workspaces) }
    this.saveConfig(next)
    return next
  }

  listWorkspaces(): ListWorkspacesData {
    const config = this.ensureInitialized()
    return {
      workspaces: this.toWorkspaceItems(config.workspaces),
    }
  }

  addWorkspace(workspacePath: string): ListWorkspacesData {
    const config = this.ensureInitialized()
    const normalizedPath = this.normalizeExistingDirectory(workspacePath)

    if (config.workspaces.some(item => item.path === normalizedPath)) {
      throw new Error(WORKSPACE_DUPLICATED_PATH)
    }

    const now = Date.now()
    this.saveConfig({
      workspaces: [
        ...config.workspaces,
        { path: normalizedPath, addedAt: now, lastOpenedAt: now },
      ],
    })

    return this.listWorkspaces()
  }

  removeWorkspace(workspacePath: string): ListWorkspacesData {
    const config = this.ensureInitialized()
    const normalizedPath = this.normalizeExistingDirectory(workspacePath)
    const defaultPath = this.getDefaultWorkspacePath()

    const workspaces = config.workspaces.filter(item => item.path !== normalizedPath)
    const nextWorkspaces = workspaces.some(item => item.path === defaultPath)
      ? workspaces
      : [{ path: defaultPath, addedAt: Date.now(), lastOpenedAt: Date.now() }, ...workspaces]

    this.saveConfig({
      workspaces: nextWorkspaces,
    })

    return this.listWorkspaces()
  }

  openWorkspace(workspacePath: string): ListWorkspacesData {
    const config = this.ensureInitialized()
    const normalizedPath = this.normalizeExistingDirectory(workspacePath)
    const workspace = config.workspaces.find(item => item.path === normalizedPath)
    if (!workspace) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }

    const now = Date.now()
    this.saveConfig({
      workspaces: config.workspaces.map(item => item.path === normalizedPath ? { ...item, lastOpenedAt: now } : item),
    })

    return this.listWorkspaces()
  }

  reorderWorkspaces(workspacePaths: string[]): ListWorkspacesData {
    const config = this.ensureInitialized()
    const normalizedPaths = workspacePaths.map(item => this.normalizeExistingDirectory(item))
    const existingPaths = new Set(config.workspaces.map(item => item.path))
    const requestedPaths = new Set(normalizedPaths)

    if (
      normalizedPaths.length !== config.workspaces.length
      || requestedPaths.size !== normalizedPaths.length
      || normalizedPaths.some(item => !existingPaths.has(item))
    ) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }

    const workspaceByPath = new Map(config.workspaces.map(item => [item.path, item]))
    this.saveConfig({
      workspaces: normalizedPaths.map(item => workspaceByPath.get(item)!),
    })

    return this.listWorkspaces()
  }

  listDirectories(inputPath?: string): WorkspaceDirectoryListing {
    const targetPath = inputPath ? path.resolve(inputPath) : os.homedir()
    const normalizedPath = path.normalize(targetPath)

    const stat = fs.statSync(normalizedPath)
    if (!stat.isDirectory()) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }

    const parentPath = path.dirname(normalizedPath)
    const resolvedParent = parentPath !== normalizedPath ? parentPath : null

    const roots = this.getRoots()
    const entries = fs.readdirSync(normalizedPath, { withFileTypes: true })
    const directories: WorkspaceDirectoryEntry[] = entries
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => {
        const fullPath = path.join(normalizedPath, entry.name)
        try {
          const realPath = fs.realpathSync.native(fullPath)
          const realStat = fs.statSync(realPath)
          return realStat.isDirectory() ? { name: entry.name, path: fullPath } : null
        }
        catch {
          return null
        }
      })
      .filter((entry): entry is WorkspaceDirectoryEntry => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name))

    return {
      currentPath: normalizedPath,
      parentPath: resolvedParent,
      roots,
      directories,
    }
  }

  createDirectory(parentPath: string, name: string): WorkspaceDirectoryEntry {
    if (!name || name === '.' || name === '..') {
      throw new Error(WORKSPACE_INVALID_PATH)
    }
    if (name.includes(path.sep) || name.includes('/') || name.includes('\\')) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }

    const normalizedParent = path.resolve(parentPath)
    const parentStat = fs.statSync(normalizedParent)
    if (!parentStat.isDirectory()) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }

    const newPath = path.join(normalizedParent, name)
    if (fs.existsSync(newPath)) {
      throw new Error(WORKSPACE_DUPLICATED_PATH)
    }

    fs.mkdirSync(newPath)
    return { name, path: newPath }
  }

  private getRoots(): string[] {
    if (process.platform === 'win32') {
      const drives: string[] = []
      for (let i = 65; i <= 90; i++) {
        const drive = `${String.fromCharCode(i)}:\\`
        try {
          fs.statSync(drive)
          drives.push(drive)
        }
        catch {}
      }
      return drives
    }
    return ['/']
  }

  private getConfig(): WorkspaceConfig {
    return this.parseConfig(this.store.read())
  }

  private saveConfig(config: WorkspaceConfig): void {
    this.store.write(this.parseConfig(config))
  }

  private parseConfig(value: unknown): WorkspaceConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Invalid workspace settings file: ${this.options.filePath}`)
    }

    const record = value as Record<string, unknown>
    if (!Array.isArray(record.workspaces)) {
      throw new TypeError(`Invalid workspace settings file: ${this.options.filePath}`)
    }

    const workspaces = record.workspaces.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`Invalid workspace settings file: ${this.options.filePath}`)
      }
      const workspace = item as Record<string, unknown>
      if (typeof workspace.path !== 'string' || typeof workspace.addedAt !== 'number') {
        throw new TypeError(`Invalid workspace settings file: ${this.options.filePath}`)
      }
      if (workspace.lastOpenedAt !== undefined && typeof workspace.lastOpenedAt !== 'number') {
        throw new Error(`Invalid workspace settings file: ${this.options.filePath}`)
      }
      return {
        path: workspace.path,
        addedAt: workspace.addedAt,
        lastOpenedAt: workspace.lastOpenedAt,
      }
    })

    // 兼容旧配置文件中残留的 currentWorkspacePath 字段:忽略不解析
    return {
      workspaces,
    }
  }

  private normalizeExistingDirectory(inputPath: string): string {
    if (!path.isAbsolute(inputPath)) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }

    const realPath = fs.realpathSync.native(inputPath)
    const stat = fs.statSync(realPath)
    if (!stat.isDirectory()) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }

    return path.normalize(realPath)
  }

  private dedupeWorkspaces(workspaces: WorkspaceConfig['workspaces']): WorkspaceConfig['workspaces'] {
    const seen = new Set<string>()
    return workspaces.filter((workspace) => {
      if (seen.has(workspace.path)) {
        return false
      }
      seen.add(workspace.path)
      return true
    })
  }

  private toWorkspaceItems(workspaces: WorkspaceConfig['workspaces']): WorkspaceItem[] {
    const displayNames = computeDisplayNames(workspaces.map(item => item.path))
    const defaultPath = this.getDefaultWorkspacePath()

    return workspaces.map((item, index) => ({
      path: item.path,
      displayName: displayNames[index],
      isDefault: item.path === defaultPath,
      lastOpenedAt: item.lastOpenedAt,
    }))
  }
}

export function computeDisplayNames(paths: string[]): string[] {
  const segmentsList = paths.map(item => path.normalize(item).split(path.sep).filter(Boolean))

  return segmentsList.map((segments, index) => {
    const basename = segments[segments.length - 1] || paths[index]
    const sameBasenameIndexes = segmentsList
      .map((otherSegments, otherIndex) => ({ otherSegments, otherIndex }))
      .filter(({ otherSegments }) => (otherSegments[otherSegments.length - 1] || '') === basename)
      .map(({ otherIndex }) => otherIndex)

    if (sameBasenameIndexes.length === 1) {
      return basename
    }

    for (let depth = 2; depth <= segments.length; depth += 1) {
      const suffix = segments.slice(-depth).join('/')
      const duplicated = sameBasenameIndexes.some((otherIndex) => {
        if (otherIndex === index) {
          return false
        }
        return segmentsList[otherIndex].slice(-depth).join('/') === suffix
      })
      if (!duplicated) {
        return depth <= 2 ? suffix : `${segments[segments.length - depth]}/.../${basename}`
      }
    }

    return paths[index]
  })
}
