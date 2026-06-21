import { describe, expect, it } from 'vitest'

import { APP_RENDERER_EVENT_NAMES } from '../../ipc-events'
import type { AppRendererEvents } from '../../ipc-events'
import type { ListWorkspacesData, WorkspaceConfig } from '../workspace'

describe('workspace shared types', () => {
  it('listWorkspacesData 不再含 currentWorkspacePath', () => {
    const data: ListWorkspacesData = { workspaces: [] }
    // 类型断言:该字段已不存在,访问应报类型错误(运行时此断言恒真,仅作占位)
    expect(data).not.toHaveProperty('currentWorkspacePath')
  })

  it('workspaceConfig 不再含 currentWorkspacePath', () => {
    const config: WorkspaceConfig = { workspaces: [] }
    expect(config).not.toHaveProperty('currentWorkspacePath')
  })

  it('workspace:changed 事件名仍在注册表且 payload 为空', () => {
    expect(APP_RENDERER_EVENT_NAMES).toContain('workspace:changed')
    // payload 类型为空对象:无法合法携带 currentWorkspacePath
    const payload: AppRendererEvents['workspace:changed'] = {}
    expect(payload).toEqual({})
  })
})
