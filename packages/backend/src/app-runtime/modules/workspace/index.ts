import type { AppRpcInput } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { canonicalizeWorkspacePath, searchWorkspaceFiles } from '../../../data'
import { Method, Module } from '../../decorators'

@Module('workspace')
export class WorkspaceModule implements RuntimeModuleMethods<'workspace'> {
  constructor(private readonly core: Pick<RuntimeCore, 'data' | 'events'>) {}

  initialize() {
    this.core.data.workspaceService.ensureInitialized()
  }

  @Method()
  listWorkspaces(_input: AppRpcInput<'workspace.listWorkspaces'>) {
    return this.core.data.workspaceService.listWorkspaces()
  }

  @Method()
  addWorkspace(input: AppRpcInput<'workspace.addWorkspace'>) {
    return this.emitWorkspaceResult(this.core.data.workspaceService.addWorkspace(canonicalizeWorkspacePath(input.path)))
  }

  @Method()
  removeWorkspace(input: AppRpcInput<'workspace.removeWorkspace'>) {
    const workspacePath = canonicalizeWorkspacePath(input.path)
    const deletePermissionGroup = input.deletePermissionGroup
      && this.core.data.permissionsFileStore.hasWorkspaceGroup(workspacePath)
    if (!deletePermissionGroup)
      return this.emitWorkspaceResult(this.core.data.workspaceService.removeWorkspace(workspacePath))

    const permissionSnapshot = this.core.data.permissionsFileStore.listAll()
    this.core.data.permissionsFileStore.clearWorkspace(workspacePath)
    let result: ReturnType<RuntimeCore['data']['workspaceService']['removeWorkspace']>
    try {
      result = this.core.data.workspaceService.removeWorkspace(workspacePath)
    }
    catch (error) {
      try {
        this.core.data.permissionsFileStore.write(permissionSnapshot)
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
    return this.emitWorkspaceResult(this.core.data.workspaceService.openWorkspace(canonicalizeWorkspacePath(input.path)))
  }

  @Method()
  reorderWorkspaces(input: AppRpcInput<'workspace.reorderWorkspaces'>) {
    return this.emitWorkspaceResult(this.core.data.workspaceService.reorderWorkspaces(input.paths))
  }

  @Method()
  getDefaultWorkspacePath(_input: AppRpcInput<'workspace.getDefaultWorkspacePath'>) {
    return this.core.data.workspaceService.getDefaultWorkspacePath()
  }

  @Method()
  listDirectories(input: AppRpcInput<'workspace.listDirectories'>) {
    return this.core.data.workspaceService.listDirectories(input?.path)
  }

  @Method()
  createDirectory(input: AppRpcInput<'workspace.createDirectory'>) {
    return this.core.data.workspaceService.createDirectory(input.parentPath, input.name)
  }

  @Method()
  async searchWorkspaceFiles(input: AppRpcInput<'workspace.searchWorkspaceFiles'>) {
    if (!input.workspacePath) {
      throw new Error('workspacePath is required')
    }
    return await searchWorkspaceFiles(input.workspacePath, input.query ?? '', input.limit ?? 50)
  }

  private emitWorkspaceResult(result: ReturnType<RuntimeCore['data']['workspaceService']['listWorkspaces']>) {
    this.core.events.emit('workspace:changed', {})
    return result
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
