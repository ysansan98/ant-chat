import type { AppRpcInput } from '@ant-chat/shared'
import type { PermissionsFileStore, WorkspaceService } from '../../../data'
import type { RuntimeEventBus } from '../../../events'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { getWorkspaceFileForStream, listDirectoryEntries, openPathWithDefaultApp, readTextFile, resolveWorkspaceFilePath, searchWorkspaceFiles } from '../../../data'
import { canonicalizeWorkspacePath } from '../../../workspace/workspaceIdentity'
import { Method, Module } from '../../decorators'

@Module('workspace')
export class WorkspaceModule implements RuntimeModuleMethods<'workspace'> {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly permissionsFileStore: PermissionsFileStore,
    private readonly events: RuntimeEventBus,
  ) {}

  initialize() {
    this.workspaceService.ensureInitialized()
  }

  @Method()
  listWorkspaces(_input: AppRpcInput<'workspace.listWorkspaces'>) {
    return this.workspaceService.listWorkspaces()
  }

  @Method()
  addWorkspace(input: AppRpcInput<'workspace.addWorkspace'>) {
    return this.emitWorkspaceResult(this.workspaceService.addWorkspace(canonicalizeWorkspacePath(input.path)))
  }

  @Method()
  removeWorkspace(input: AppRpcInput<'workspace.removeWorkspace'>) {
    const workspacePath = canonicalizeWorkspacePath(input.path)
    const deletePermissionGroup = input.deletePermissionGroup
      && this.permissionsFileStore.hasWorkspaceGroup(workspacePath)
    if (!deletePermissionGroup)
      return this.emitWorkspaceResult(this.workspaceService.removeWorkspace(workspacePath))

    const permissionSnapshot = this.permissionsFileStore.listAll()
    this.permissionsFileStore.clearWorkspace(workspacePath)
    let result: ReturnType<WorkspaceService['removeWorkspace']>
    try {
      result = this.workspaceService.removeWorkspace(workspacePath)
    }
    catch (error) {
      try {
        this.permissionsFileStore.write(permissionSnapshot)
      }
      catch (rollbackError) {
        throw new Error(`删除工作区失败：${errorMessage(error)}；权限分组回滚失败：${errorMessage(rollbackError)}`)
      }
      throw error
    }
    return this.emitWorkspaceResult(result)
  }

  @Method()
  openWorkspace(input: AppRpcInput<'workspace.openWorkspace'>) {
    return this.emitWorkspaceResult(this.workspaceService.openWorkspace(canonicalizeWorkspacePath(input.path)))
  }

  @Method()
  reorderWorkspaces(input: AppRpcInput<'workspace.reorderWorkspaces'>) {
    return this.emitWorkspaceResult(this.workspaceService.reorderWorkspaces(input.paths))
  }

  @Method()
  getDefaultWorkspacePath(_input: AppRpcInput<'workspace.getDefaultWorkspacePath'>) {
    return this.workspaceService.getDefaultWorkspacePath()
  }

  @Method()
  listDirectories(input: AppRpcInput<'workspace.listDirectories'>) {
    return this.workspaceService.listDirectories(input?.path)
  }

  @Method()
  createDirectory(input: AppRpcInput<'workspace.createDirectory'>) {
    return this.workspaceService.createDirectory(input.parentPath, input.name)
  }

  @Method()
  async searchWorkspaceFiles(input: AppRpcInput<'workspace.searchWorkspaceFiles'>) {
    if (!input.workspacePath) {
      throw new Error('workspacePath is required')
    }
    return await searchWorkspaceFiles(input.workspacePath, input.query ?? '', input.limit ?? 50)
  }

  @Method()
  async listDirectoryEntries(input: AppRpcInput<'workspace.listDirectoryEntries'>) {
    const workspacePath = this.requireWorkspace(input.workspacePath)
    return await listDirectoryEntries(workspacePath, input.relPath)
  }

  @Method()
  async readTextFile(input: AppRpcInput<'workspace.readTextFile'>) {
    const workspacePath = this.requireWorkspace(input.workspacePath)
    return await readTextFile(workspacePath, input.relPath)
  }

  @Method()
  async resolveFileForStream(input: AppRpcInput<'workspace.resolveFileForStream'>) {
    const workspacePath = this.requireWorkspace(input.workspacePath)
    return await getWorkspaceFileForStream(workspacePath, input.relPath)
  }

  @Method()
  async openWithDefaultApp(input: AppRpcInput<'workspace.openWithDefaultApp'>) {
    const workspacePath = this.requireWorkspace(input.workspacePath)
    const absolutePath = resolveWorkspaceFilePath(workspacePath, input.relPath)
    await openPathWithDefaultApp(absolutePath)
  }

  /** 校验 workspacePath 为已注册且真实存在的工作区，返回规范化后的真实路径。 */
  private requireWorkspace(workspacePath: string): string {
    if (!workspacePath) {
      throw new Error('workspacePath is required')
    }
    let normalized: string
    try {
      normalized = canonicalizeWorkspacePath(workspacePath)
    }
    catch {
      throw new Error('工作区不可用')
    }
    const registered = this.workspaceService.listWorkspaces().workspaces.some(item => item.path === normalized)
    if (!registered) {
      throw new Error('工作区未注册')
    }
    return normalized
  }

  private emitWorkspaceResult(result: ReturnType<WorkspaceService['listWorkspaces']>) {
    this.events.emit('workspace:changed', {})
    return result
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
