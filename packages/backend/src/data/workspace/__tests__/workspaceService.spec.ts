import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
      const raw = readWorkspaceFile(configPath)
      expect(raw.data).not.toHaveProperty('currentWorkspacePath')
      expect(Array.isArray(raw.data.workspaces)).toBe(true)
      expect(raw.schemaVersion).toBe(1)
    }
    finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('openWorkspace 只更新 lastOpenedAt,不写 currentWorkspacePath', () => {
    const list = service.listWorkspaces()
    const target = list.workspaces[0]
    service.openWorkspace(target.path)
    const raw = readWorkspaceFile(configPath)
    expect(raw.data).not.toHaveProperty('currentWorkspacePath')
    const opened = raw.data.workspaces
      .find(item => item.path === target.path)
    expect(opened?.lastOpenedAt).toBeTypeOf('number')
  })

  it('removeWorkspace 删除当前工作区后配置仍不含 currentWorkspacePath', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-rm-'))
    try {
      service.addWorkspace(dir)
      service.removeWorkspace(dir)
      const raw = readWorkspaceFile(configPath)
      expect(raw.data).not.toHaveProperty('currentWorkspacePath')
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

  it('reorderWorkspaces 按传入路径顺序持久化工作区列表', () => {
    const firstDir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-first-'))
    const secondDir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-second-'))
    try {
      service.addWorkspace(firstDir)
      service.addWorkspace(secondDir)
      const before = service.listWorkspaces().workspaces
      const nextPaths = [before[2].path, before[0].path, before[1].path]

      const reordered = service.reorderWorkspaces(nextPaths)
      const raw = readWorkspaceFile(configPath)

      expect(reordered.workspaces.map(item => item.path)).toEqual(nextPaths)
      expect(raw.data.workspaces.map(item => item.path)).toEqual(nextPaths)
    }
    finally {
      rmSync(firstDir, { force: true, recursive: true })
      rmSync(secondDir, { force: true, recursive: true })
    }
  })

  it('reorderWorkspaces 拒绝缺失或重复的路径', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-reorder-invalid-'))
    try {
      service.addWorkspace(dir)
      const paths = service.listWorkspaces().workspaces.map(item => item.path)

      expect(() => service.reorderWorkspaces([paths[0]])).toThrow('WORKSPACE_INVALID_PATH')
      expect(() => service.reorderWorkspaces([paths[0], paths[0]])).toThrow('WORKSPACE_INVALID_PATH')
    }
    finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})

function readWorkspaceFile(filePath: string): {
  schemaVersion: number
  data: { workspaces: Array<{ path: string, lastOpenedAt?: number }> }
} {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

describe('workspaceService listDirectories listing', () => {
  let configPath: string
  let service: WorkspaceService

  beforeEach(() => {
    configPath = path.join(mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-')), 'workspace.json')
    service = new WorkspaceService({ filePath: configPath })
  })

  afterEach(() => {
    rmSync(path.dirname(configPath), { force: true, recursive: true })
  })

  it('返回平台正确的根目录、面包屑与父子路径', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-ws-listing-'))
    const subDir = path.join(dir, 'nested')
    mkdirSync(subDir)
    try {
      const listing = service.listDirectories(dir)

      const root = path.parse(listing.currentPath).root
      // 面包屑首项为根（POSIX '/'，Windows 'C:'），末项为当前目录
      expect(listing.breadcrumbs.length).toBeGreaterThanOrEqual(2)
      expect(listing.breadcrumbs[0].path).toBe(root)
      expect(listing.breadcrumbs[0].name.length).toBeGreaterThan(0)
      const last = listing.breadcrumbs[listing.breadcrumbs.length - 1]
      expect(last.path).toBe(listing.currentPath)
      expect(last.name).toBe(path.basename(listing.currentPath))
      // 从根逐级拼接即当前路径，供前端直接跳转使用
      const joined = listing.breadcrumbs
        .slice(1)
        .reduce((acc, crumb) => path.join(acc, crumb.name), listing.breadcrumbs[0].path)
      expect(joined).toBe(listing.currentPath)

      expect(listing.parentPath).toBe(path.dirname(listing.currentPath))
      expect(listing.roots.length).toBeGreaterThan(0)
      expect(listing.roots.every(item => path.isAbsolute(item.path) && item.label.length > 0)).toBe(true)
      expect(listing.directories.some(item => item.path === subDir && item.name === 'nested')).toBe(true)
    }
    finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('根目录层面 parentPath 为 null 且面包屑只有根一项', () => {
    const root = path.parse(tmpdir()).root
    const listing = service.listDirectories(root)

    expect(listing.currentPath).toBe(root)
    expect(listing.parentPath).toBeNull()
    expect(listing.breadcrumbs).toHaveLength(1)
    expect(listing.breadcrumbs[0].path).toBe(root)
  })
})
