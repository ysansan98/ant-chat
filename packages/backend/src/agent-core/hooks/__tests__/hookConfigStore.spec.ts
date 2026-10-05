import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HookConfigStore, WORKSPACE_HOOKS_RELATIVE_PATH } from '../hookConfigStore'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-hooks-'))
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8')
}

describe('hookConfigStore', () => {
  let root: string
  let globalFilePath: string
  let workspacePath: string
  let logger: { warn: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    root = createTempDir()
    globalFilePath = path.join(root, 'hooks.json')
    workspacePath = path.join(root, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    logger = { warn: vi.fn() }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function createStore() {
    return new HookConfigStore({ globalFilePath, logger: logger as never })
  }

  it('缺失文件时返回空配置', () => {
    const store = createStore()
    expect(store.readSource('global', workspacePath)).toEqual({ schemaVersion: 1, hooks: {} })
    expect(store.readSource('workspace', workspacePath)).toEqual({ schemaVersion: 1, hooks: {} })
    expect(store.resolveForEvent('PreToolUse', workspacePath)).toEqual([])
  })

  it('global 与 workspace 都执行，且 global 在前', () => {
    writeJson(globalFilePath, {
      schemaVersion: 1,
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'global.sh' }] }],
      },
    })
    writeJson(path.join(workspacePath, WORKSPACE_HOOKS_RELATIVE_PATH), {
      schemaVersion: 1,
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'workspace.sh' }] }],
      },
    })

    const groups = createStore().resolveForEvent('PreToolUse', workspacePath)
    expect(groups.map(item => item.source)).toEqual(['global', 'workspace'])
    expect(groups.map(item => item.group.hooks[0].command)).toEqual(['global.sh', 'workspace.sh'])
  })

  it('只返回请求事件的配置', () => {
    writeJson(globalFilePath, {
      schemaVersion: 1,
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
    })
    expect(createStore().resolveForEvent('PreToolUse', workspacePath)).toEqual([])
    expect(createStore().resolveForEvent('Stop', workspacePath)).toHaveLength(1)
  })

  it('损坏 JSON 被隔离并按无 hook 继续', () => {
    fs.writeFileSync(globalFilePath, '{ not json', 'utf8')
    const store = createStore()
    expect(store.readSource('global', workspacePath)).toEqual({ schemaVersion: 1, hooks: {} })
    expect(fs.existsSync(globalFilePath)).toBe(false)
    const quarantined = fs.readdirSync(root).filter(name => name.includes('hooks.json.corrupted-'))
    expect(quarantined).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('schema 校验失败（未知事件）被隔离', () => {
    writeJson(globalFilePath, {
      schemaVersion: 1,
      hooks: { NotAnEvent: [{ hooks: [{ type: 'command', command: 'x.sh' }] }] },
    })
    expect(createStore().readSource('global', workspacePath)).toEqual({ schemaVersion: 1, hooks: {} })
    expect(fs.readdirSync(root).some(name => name.includes('.corrupted-'))).toBe(true)
  })

  it('schemaVersion 不匹配时隔离', () => {
    writeJson(globalFilePath, { schemaVersion: 2, hooks: {} })
    expect(createStore().readSource('global', workspacePath)).toEqual({ schemaVersion: 1, hooks: {} })
    expect(fs.readdirSync(root).some(name => name.includes('.corrupted-'))).toBe(true)
  })
})
