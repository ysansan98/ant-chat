import type { AppRpcInput } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { searchWorkspaceFiles } from '../../../data'
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
    return this.emitWorkspaceResult(this.core.data.workspaceService.addWorkspace(input.path))
  }

  @Method()
  removeWorkspace(input: AppRpcInput<'workspace.removeWorkspace'>) {
    return this.emitWorkspaceResult(this.core.data.workspaceService.removeWorkspace(input.path))
  }

  @Method()
  openWorkspace(input: AppRpcInput<'workspace.openWorkspace'>) {
    return this.emitWorkspaceResult(this.core.data.workspaceService.openWorkspace(input.path))
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
