import type { AppRpcInput } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { canonicalizePermissionRuleInput, canonicalizeWorkspacePath } from '../../../data/permissions'
import { Method, Module } from '../../decorators'

/** 权限管理 RPC 只接收类型化能力输入，规则身份和资源规范化由后端负责。 */
@Module('permissions')
export class PermissionsModule implements RuntimeModuleMethods<'permissions'> {
  constructor(private readonly core: Pick<RuntimeCore, 'data' | 'logger'>) {}

  @Method()
  list(_input?: AppRpcInput<'permissions.list'>) {
    return this.core.data.permissionsFileStore.listAll()
  }

  @Method()
  add(input: AppRpcInput<'permissions.add'>) {
    return this.core.data.permissionsFileStore.addRule(
      input.scope,
      this.resolveScopeWorkspace(input.scope, input.workspacePath),
      canonicalizePermissionRuleInput(input.rule),
    )
  }

  @Method()
  update(input: AppRpcInput<'permissions.update'>) {
    return this.core.data.permissionsFileStore.updateRule(
      input.ruleId,
      input.scope,
      this.resolveScopeWorkspace(input.scope, input.workspacePath),
      canonicalizePermissionRuleInput(input.rule),
    )
  }

  @Method()
  delete(input: AppRpcInput<'permissions.delete'>) {
    this.core.data.permissionsFileStore.deleteRule(
      input.ruleId,
      input.scope,
      this.resolveScopeWorkspace(input.scope, input.workspacePath),
    )
    return null
  }

  @Method()
  clear(input: AppRpcInput<'permissions.clear'>) {
    this.core.data.permissionsFileStore.clearScope(
      input.scope,
      this.resolveScopeWorkspace(input.scope, input.workspacePath),
    )
    return null
  }

  @Method()
  clearWorkspace(input: AppRpcInput<'permissions.clearWorkspace'>) {
    this.core.data.permissionsFileStore.clearWorkspace(this.resolveExistingWorkspaceGroup(input.workspacePath))
    return null
  }

  private resolveScopeWorkspace(
    scope: 'workspace' | 'global',
    workspacePath: string | undefined,
  ): string | undefined {
    if (scope === 'global') {
      if (workspacePath !== undefined)
        throw new Error('全局权限不能指定 workspacePath')
      return undefined
    }
    if (!workspacePath)
      throw new Error('workspace scope 需要 workspacePath')
    return this.resolveExistingWorkspaceGroup(workspacePath)
  }

  /** 已保存分组的 key 已是稳定身份；目录消失后仍必须允许用户管理该分组。 */
  private resolveExistingWorkspaceGroup(workspacePath: string): string {
    const workspaces = this.core.data.permissionsFileStore.listAll().workspaces
    if (workspacePath in workspaces)
      return workspacePath
    return canonicalizeWorkspacePath(workspacePath)
  }
}
