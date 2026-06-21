import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeDisplayNames, WorkspaceService } from '../workspaceService'

describe('workspace display names', () => {
  it('同名目录从第一个不同上级目录开始展示', () => {
    const names = computeDisplayNames([
      '/tmp/test/demo',
      '/tmp/test1/demo',
      '/tmp/test1/a/b/demo',
      '/tmp/test2/a/b/demo',
      '/tmp/unique',
    ])

    expect(names).toEqual([
      'test/demo',
      'test1/demo',
      'test1/.../demo',
      'test2/.../demo',
      'unique',
    ])
  })
})

describe('workspaceService currentWorkspacePath 整合', () => {
  let configPath: string
  let service: WorkspaceService

  beforeEach(() => {
    configPath = path.join(mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-')), 'workspace.json')
    service = new WorkspaceService({ filePath: configPath })
  })

  afterEach(() => {
    rmSync(path.dirname(configPath), { force: true, recursive: true })
  })

  it('listWorkspaces 不再返回 currentWorkspacePath', () => {
    const data = service.listWorkspaces()
    expect(data).not.toHaveProperty('currentWorkspacePath')
    expect(data.workspaces.length).toBeGreaterThan(0)
  })

  it('addWorkspace 后配置文件只持久化 workspaces,不含 currentWorkspacePath', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-added-'))
    try {
      service.addWorkspace(dir)
      const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
      expect(raw).not.toHaveProperty('currentWorkspacePath')
      expect(Array.isArray(raw.workspaces)).toBe(true)
    }
    finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('openWorkspace 只更新 lastOpenedAt,不写 currentWorkspacePath', () => {
    const list = service.listWorkspaces()
    const target = list.workspaces[0]
    service.openWorkspace(target.path)
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(raw).not.toHaveProperty('currentWorkspacePath')
    const opened = (raw.workspaces as Array<{ path: string, lastOpenedAt?: number }>)
      .find(item => item.path === target.path)
    expect(opened?.lastOpenedAt).toBeTypeOf('number')
  })

  it('removeWorkspace 删除当前工作区后配置仍不含 currentWorkspacePath', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-rm-'))
    try {
      service.addWorkspace(dir)
      service.removeWorkspace(dir)
      const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
      expect(raw).not.toHaveProperty('currentWorkspacePath')
    }
    finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('读取含旧 currentWorkspacePath 字段的配置文件时容忍并忽略该字段', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-legacy-'))
    try {
      // 先正常添加,再手写一个含旧字段的配置
      service.addWorkspace(dir)
      // workspaceService 内部使用 realpathSync.native 规范化路径(macOS 上 /var -> /private/var)
      const realDir = realpathSync.native(dir)
      const legacy = {
        currentWorkspacePath: realDir,
        workspaces: [
          { path: realDir, addedAt: 1, lastOpenedAt: 2 },
        ],
      }
      writeFileSync(configPath, JSON.stringify(legacy))

      // 重新创建 service 读取旧配置,不应抛错
      const legacyService = new WorkspaceService({ filePath: configPath })
      const data = legacyService.listWorkspaces()
      expect(data).not.toHaveProperty('currentWorkspacePath')
      expect(data.workspaces.some(item => item.path === realDir)).toBe(true)
    }
    finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
