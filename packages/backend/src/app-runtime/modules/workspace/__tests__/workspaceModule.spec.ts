import type { AppRpcInput } from '@ant-chat/shared'
import type { PermissionsFileStore, WorkspaceService } from '../../../../data'
import type { RuntimeEventBus } from '../../../../events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceModule } from '..'

describe('工作区模块', () => {
  let rootPath: string

  afterEach(() => {
    if (rootPath)
      rmSync(rootPath, { force: true, recursive: true })
  })

  it('权限分组清理失败时不提交工作区删除', () => {
    rootPath = mkdtempSync(path.join(tmpdir(), 'ant-chat-workspace-module-'))
    const workspacePath = path.join(rootPath, 'workspace')
    mkdirSync(workspacePath)
    const workspaceService = {
      removeWorkspace: vi.fn(),
    } as unknown as WorkspaceService
    const permissionsFileStore = {
      hasWorkspaceGroup: vi.fn(() => true),
      listAll: vi.fn(() => ({ global: [], workspaces: {} })),
      clearWorkspace: vi.fn(() => {
        throw new Error('permissions cleanup failed')
      }),
      write: vi.fn(),
    } as unknown as PermissionsFileStore
    const events = { emit: vi.fn() } as unknown as RuntimeEventBus
    const module = new WorkspaceModule(workspaceService, permissionsFileStore, events)

    expect(() => module.removeWorkspace({
      path: workspacePath,
      deletePermissionGroup: true,
    } as AppRpcInput<'workspace.removeWorkspace'>)).toThrow('permissions cleanup failed')

    expect(workspaceService.removeWorkspace).not.toHaveBeenCalled()
    expect(permissionsFileStore.write).not.toHaveBeenCalled()
  })
})
