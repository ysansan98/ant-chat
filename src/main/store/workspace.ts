import type { ListWorkspacesData, WorkspaceConfig, WorkspaceItem } from '@ant-chat/shared'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WORKSPACE_DUPLICATED_PATH, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'
import Store from 'electron-store'

const WORKSPACE_STORE_KEY = 'workspaceConfig'

const schema = {
  workspaceConfig: {
    type: 'object' as const,
    properties: {
      currentWorkspacePath: { type: 'string' as const },
      workspaces: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            path: { type: 'string' as const },
            addedAt: { type: 'number' as const },
            lastOpenedAt: { type: 'number' as const },
          },
          required: ['path', 'addedAt'],
        },
        default: [],
      },
    },
    required: ['workspaces'],
  },
}

export class WorkspaceStore {
  private static instance: WorkspaceStore
  private store = new Store({ schema })

  static getInstance(): WorkspaceStore {
    if (!WorkspaceStore.instance) {
      WorkspaceStore.instance = new WorkspaceStore()
    }
    return WorkspaceStore.instance
  }

  getDefaultWorkspacePath(): string {
    return path.normalize(path.join(os.homedir(), '.ant-chat'))
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

    const currentWorkspacePath = current.currentWorkspacePath && workspaces.some(item => item.path === current.currentWorkspacePath)
      ? current.currentWorkspacePath
      : defaultPath

    const next = {
      currentWorkspacePath,
      workspaces: this.dedupeWorkspaces(workspaces),
    }
    this.saveConfig(next)
    return next
  }

  listWorkspaces(): ListWorkspacesData {
    const config = this.ensureInitialized()
    return {
      currentWorkspacePath: config.currentWorkspacePath || this.getDefaultWorkspacePath(),
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
      currentWorkspacePath: normalizedPath,
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
      currentWorkspacePath: config.currentWorkspacePath === normalizedPath ? defaultPath : config.currentWorkspacePath,
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
      currentWorkspacePath: normalizedPath,
      workspaces: config.workspaces.map(item => item.path === normalizedPath ? { ...item, lastOpenedAt: now } : item),
    })

    return this.listWorkspaces()
  }

  getCurrentWorkspacePath(): string {
    const config = this.ensureInitialized()
    return config.currentWorkspacePath || this.getDefaultWorkspacePath()
  }

  private getConfig(): WorkspaceConfig {
    return this.store.get(WORKSPACE_STORE_KEY, { workspaces: [] }) as WorkspaceConfig
  }

  private saveConfig(config: WorkspaceConfig): void {
    this.store.set(WORKSPACE_STORE_KEY, config)
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
    const basename = segments.at(-1) || paths[index]
    const sameBasenameIndexes = segmentsList
      .map((otherSegments, otherIndex) => ({ otherSegments, otherIndex }))
      .filter(({ otherSegments }) => (otherSegments.at(-1) || '') === basename)
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
        return depth <= 2 ? suffix : `${segments.at(-depth)}/.../${basename}`
      }
    }

    return paths[index]
  })
}
