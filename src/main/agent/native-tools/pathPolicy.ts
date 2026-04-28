import fs from 'node:fs'
import path from 'node:path'
import { WORKSPACE_INVALID_PATH } from '@ant-chat/shared'

export class PathPolicy {
  constructor(private readonly workspacePath: string) {}

  resolveExisting(inputPath: string = '.'): string {
    const resolvedPath = this.resolvePath(inputPath)
    const realPath = fs.realpathSync.native(resolvedPath)
    this.assertInsideWorkspace(realPath)
    return realPath
  }

  resolveForWrite(inputPath: string): string {
    const resolvedPath = this.resolvePath(inputPath)

    if (fs.existsSync(resolvedPath)) {
      const realPath = fs.realpathSync.native(resolvedPath)
      this.assertInsideWorkspace(realPath)
      return realPath
    }

    const ancestorRealPath = fs.realpathSync.native(findExistingAncestor(path.dirname(resolvedPath)))
    this.assertInsideWorkspace(ancestorRealPath)
    this.assertInsideWorkspace(resolvedPath)
    return resolvedPath
  }

  assertPatchPath(inputPath: string): string {
    if (!inputPath || path.isAbsolute(inputPath) || inputPath.includes('\\')) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }

    const normalized = path.posix.normalize(inputPath)
    if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
      throw new Error(WORKSPACE_INVALID_PATH)
    }

    return normalized
  }

  resolvePatchPath(inputPath: string, mode: 'existing' | 'write'): string {
    const normalized = this.assertPatchPath(inputPath)
    return mode === 'existing'
      ? this.resolveExisting(normalized)
      : this.resolveForWrite(normalized)
  }

  isInsideWorkspace(candidatePath: string): boolean {
    const workspaceRealPath = fs.realpathSync.native(this.workspacePath)
    const relativePath = path.relative(workspaceRealPath, candidatePath)
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  }

  assertInsideWorkspace(candidatePath: string): void {
    if (!this.isInsideWorkspace(candidatePath)) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }
  }

  private resolvePath(inputPath: string): string {
    const targetPath = inputPath || '.'
    const resolvedPath = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.workspacePath, targetPath)

    this.assertInsideWorkspace(resolvedPath)
    return resolvedPath
  }
}

export function createPathPolicy(workspacePath: string): PathPolicy {
  return new PathPolicy(fs.realpathSync.native(workspacePath))
}

function findExistingAncestor(inputPath: string): string {
  let currentPath = inputPath
  while (!fs.existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath)
    if (parentPath === currentPath) {
      throw new Error(WORKSPACE_INVALID_PATH)
    }
    currentPath = parentPath
  }
  return currentPath
}
