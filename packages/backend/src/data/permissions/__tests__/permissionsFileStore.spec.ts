import type { ToolApprovalRule } from '@ant-chat/shared'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionsFileStore, PermissionsFileStoreReadError } from '../permissionsFileStore'

describe('permissionsFileStore', () => {
  let dir: string
  let filePath: string
  let store: PermissionsFileStore

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-permissions-'))
    filePath = path.join(dir, 'permissions.json')
    store = new PermissionsFileStore(filePath)
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { force: true, recursive: true })
  })

  it('权限文件不存在时返回空集合且不创建文件', () => {
    expect(store.read()).toEqual({ global: [], workspaces: {} })
    expect(existsSync(filePath)).toBe(false)
  })

  it.each([
    ['JSON 损坏', '{'],
    ['schema 损坏', JSON.stringify({ schemaVersion: 1, data: { global: [invalidDirectoryWrite()], workspaces: {} } })],
  ])('%s时隔离原文件、创建合法空文件并报告读取错误', (_name, content) => {
    writeFileSync(filePath, content, 'utf8')

    let readError: unknown
    try {
      store.read()
    }
    catch (error) {
      readError = error
    }
    expect(readError).toBeInstanceOf(PermissionsFileStoreReadError)
    expect((readError as PermissionsFileStoreReadError).cause).toBeTruthy()
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
      schemaVersion: 1,
      data: { global: [], workspaces: {} },
    })
    expect(store.read()).toEqual({ global: [], workspaces: {} })
    const quarantined = readdirSync(dir).find(name => name.startsWith('permissions.json.corrupted-'))
    expect(quarantined).toBeTruthy()
    expect(readFileSync(path.join(dir, quarantined!), 'utf8')).toBe(content)
  })

  it('批量保存包含非法规则时整批不落盘', () => {
    store.write({ global: [commandRule('existing')], workspaces: {} })
    const before = readFileSync(filePath, 'utf8')

    expect(() => store.saveRules('global', '', [
      commandRule('new'),
      invalidDirectoryWrite(),
    ])).toThrow('目录规则只支持读取')

    expect(readFileSync(filePath, 'utf8')).toBe(before)
  })

  it('全局和工作区规则独立保存并只组合当前工作区', () => {
    store.saveRules('global', '', [commandRule('global')])
    store.saveRules('workspace', '/workspace/a', [commandRule('workspace-a')])
    store.saveRules('workspace', '/workspace/b', [commandRule('workspace-b')])

    expect(store.getEffectiveRules('/workspace/a')).toEqual({
      global: [commandRule('global')],
      workspace: [commandRule('workspace-a')],
    })
    expect(store.getEffectiveRules('/workspace/missing')).toEqual({
      global: [commandRule('global')],
      workspace: [],
    })
  })

  it('更新保留 id 和 createdAt，只刷新 updatedAt', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const created = store.addRule('global', undefined, commandRuleInput('git'))
    vi.setSystemTime(2_000)

    const updated = store.updateRule(created.id, 'global', undefined, {
      ...commandRuleInput('git'),
      argvPrefix: ['show'],
    })

    expect(updated).toEqual(expect.objectContaining({
      id: created.id,
      createdAt: 1_000,
      updatedAt: 2_000,
      argvPrefix: ['show'],
    }))
  })

  it('更新或删除不存在的规则时明确报错且不改文件', () => {
    store.write({ global: [commandRule('existing')], workspaces: {} })
    const before = readFileSync(filePath, 'utf8')

    expect(() => store.updateRule('missing', 'global', undefined, commandRuleInput('git')))
      .toThrow('权限规则不存在：missing')
    expect(() => store.deleteRule('missing', 'global', undefined))
      .toThrow('权限规则不存在：missing')
    expect(readFileSync(filePath, 'utf8')).toBe(before)
  })
})

function commandRule(id: string): ToolApprovalRule {
  return {
    ...commandRuleInput('git'),
    id,
    createdAt: 1,
    updatedAt: 1,
  }
}

function commandRuleInput(executable: string) {
  return {
    kind: 'command' as const,
    interpreter: 'bash' as const,
    executable,
    argvPrefix: ['status'],
    allowRemainingArgs: false,
    resourceScope: 'workspace' as const,
  }
}

function invalidDirectoryWrite(): ToolApprovalRule {
  return {
    kind: 'filesystem',
    id: 'invalid-directory-write',
    createdAt: 1,
    updatedAt: 1,
    access: 'write',
    targetType: 'directory',
    canonicalPath: '/workspace',
    recursive: true,
  }
}
