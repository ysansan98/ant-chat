import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionsFileStore } from '../../../../data/permissions'
import { PermissionsModule } from '..'

describe('permissions module', () => {
  let dir: string
  let workspacePath: string
  let store: PermissionsFileStore
  let module: PermissionsModule

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-permissions-module-'))
    workspacePath = path.join(dir, 'workspace')
    mkdirSync(workspacePath)
    store = new PermissionsFileStore(path.join(dir, 'permissions.json'))
    module = new PermissionsModule({
      data: { permissionsFileStore: store },
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    } as never)
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
  })

  it('添加 PATH 命令名时不解析也不保存真实路径', () => {
    const workspaceAlias = path.join(dir, 'workspace-alias')
    const filePath = path.join(workspacePath, 'source.txt')
    const fileAlias = path.join(workspacePath, 'source-alias.txt')
    symlinkSync(workspacePath, workspaceAlias)
    writeFileSync(filePath, 'content', 'utf8')
    symlinkSync(filePath, fileAlias)
    const canonicalWorkspacePath = realpathSync.native(workspacePath)

    const filesystemRule = module.add({
      scope: 'workspace',
      workspacePath: workspaceAlias,
      rule: {
        kind: 'filesystem',
        access: 'read',
        targetType: 'file',
        canonicalPath: fileAlias,
        recursive: false,
      },
    })
    const commandRule = module.add({
      scope: 'global',
      rule: {
        kind: 'command',
        interpreter: 'bash',
        executable: 'tool',
        argvPrefix: ['status'],
        allowRemainingArgs: false,
        resourceScope: 'workspace',
      },
    })

    expect(filesystemRule).toEqual(expect.objectContaining({
      canonicalPath: path.join(canonicalWorkspacePath, 'source.txt'),
    }))
    expect(commandRule).toEqual(expect.objectContaining({
      executable: 'tool',
      interpreter: 'bash',
    }))
    expect(commandRule).not.toHaveProperty('executablePath')
    expect(store.listAll().workspaces).toHaveProperty(canonicalWorkspacePath)
  })

  it('添加命令规则时也接受可执行文件绝对路径', () => {
    const executablePath = path.join(workspacePath, 'tool')
    const executableAlias = path.join(workspacePath, 'tool-alias')
    writeFileSync(executablePath, '#!/bin/sh\n', 'utf8')
    chmodSync(executablePath, 0o755)
    symlinkSync(executablePath, executableAlias)

    const rule = module.add({
      scope: 'global',
      rule: {
        kind: 'command',
        interpreter: 'bash',
        executable: executableAlias,
        argvPrefix: [],
        allowRemainingArgs: true,
        resourceScope: 'workspace',
      },
    })

    // 规则保存用户输入的原始字符串，不解析 symlink
    expect(rule).toEqual(expect.objectContaining({
      executable: executableAlias,
    }))
    expect(rule).not.toHaveProperty('executablePath')
  })

  it('拒绝前端提交 id 和时间戳直灌持久规则', () => {
    expect(() => module.add({
      scope: 'global',
      rule: {
        kind: 'mcp-tool',
        serverName: 'server',
        toolName: 'read',
        id: 'client-id',
        createdAt: 1,
        updatedAt: 1,
      } as never,
    })).toThrow()
    expect(store.listAll()).toEqual({ global: [], workspaces: {} })
  })

  it('不存在的文件写入规则绑定最近存在祖先的真实路径', () => {
    const workspaceAlias = path.join(dir, 'workspace-alias')
    symlinkSync(workspacePath, workspaceAlias)
    const canonicalWorkspacePath = realpathSync.native(workspacePath)

    const rule = module.add({
      scope: 'global',
      rule: {
        kind: 'filesystem',
        access: 'write',
        targetType: 'file',
        canonicalPath: path.join(workspaceAlias, 'new', 'output.txt'),
        recursive: false,
      },
    })

    expect(rule).toEqual(expect.objectContaining({
      canonicalPath: path.join(canonicalWorkspacePath, 'new', 'output.txt'),
    }))
  })

  it('工作区目录消失后仍可按稳定分组 key 更新、删除和清空规则', () => {
    const first = module.add({
      scope: 'workspace',
      workspacePath,
      rule: { kind: 'mcp-tool', serverName: 'before', toolName: 'inspect' },
    })
    module.add({
      scope: 'workspace',
      workspacePath,
      rule: { kind: 'mcp-tool', serverName: 'other', toolName: 'inspect' },
    })
    const canonicalWorkspacePath = realpathSync.native(workspacePath)
    rmSync(workspacePath, { recursive: true })

    expect(module.update({
      scope: 'workspace',
      workspacePath: canonicalWorkspacePath,
      ruleId: first.id,
      rule: { kind: 'mcp-tool', serverName: 'after', toolName: 'inspect' },
    })).toEqual(expect.objectContaining({
      id: first.id,
      createdAt: first.createdAt,
      serverName: 'after',
    }))
    module.delete({
      scope: 'workspace',
      workspacePath: canonicalWorkspacePath,
      ruleId: first.id,
    })
    module.clearWorkspace({ workspacePath: canonicalWorkspacePath })

    expect(store.listAll().workspaces).not.toHaveProperty(canonicalWorkspacePath)
  })

  it('创建全新工作区分组时仍要求目录真实存在', () => {
    expect(() => module.add({
      scope: 'workspace',
      workspacePath: path.join(dir, 'missing-workspace'),
      rule: { kind: 'mcp-tool', serverName: 'demo', toolName: 'inspect' },
    })).toThrow()
  })
})
