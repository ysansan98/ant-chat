import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserSessionManager } from '../browserSessionManager'

describe('browserSessionManager 行为', () => {
  let root: string
  let originalPath: string | undefined

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-browser-session-'))
    const executablePath = path.join(root, 'agent-browser')
    fs.writeFileSync(executablePath, '#!/usr/bin/env node\nprocess.exit(0)\n')
    fs.chmodSync(executablePath, 0o755)
    originalPath = process.env.PATH
    process.env.PATH = [root, path.dirname(process.execPath)].join(path.delimiter)
  })

  afterEach(() => {
    process.env.PATH = originalPath
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('同一会话复用一个 session 且隔离不同会话', () => {
    const manager = createManager()

    const firstTurn = manager.get('conv-1')
    const secondTurn = manager.get('conv-1')
    const otherConversation = manager.get('conv-2')

    expect(secondTurn).toBe(firstTurn)
    expect(otherConversation.sessionName).not.toBe(firstTurn.sessionName)
    expect(otherConversation.socketPath).not.toBe(firstTurn.socketPath)
  })

  it('应用重启后派生稳定的 session 路径', () => {
    const first = createManager().get('conv-1')
    const restored = createManager().get('conv-1')

    expect(restored.sessionName).toBe(first.sessionName)
    expect(restored.socketPath).toBe(first.socketPath)
  })

  it('会话关闭时释放 session', async () => {
    const manager = createManager()
    const first = manager.get('conv-1')
    fs.mkdirSync(first.socketPath, { recursive: true })

    await manager.close('conv-1', true)
    const next = manager.get('conv-1')

    expect(next).not.toBe(first)
    expect(next).toMatchObject({ started: false, headed: false })
    expect(fs.existsSync(first.socketPath)).toBe(false)
  })

  it('认证状态 generation 变化后创建新会话并保留旧会话状态', () => {
    let generation = 0
    const provider = {
      getGeneration: () => generation,
      getCookies: () => [{ name: `sid-${generation}`, value: 'secret', domain: '.example.com', path: '/', secure: true, httpOnly: true }],
    }
    const manager = new BrowserSessionManager({
      artifactsPath: path.join(root, 'artifacts'),
    }, provider)
    const first = manager.get('conv-1')
    generation = 1

    const next = manager.get('conv-1')

    expect(next).not.toBe(first)
    expect(next.authGeneration).toBe(1)
    expect(next.authCookies?.[0]?.name).toBe('sid-1')
  })

  it('认证状态未初始化时快照标记为未初始化', () => {
    const provider = {
      getGeneration: () => 0,
      getCookies: () => null,
      isInitialized: () => false,
    }
    const manager = new BrowserSessionManager({
      artifactsPath: path.join(root, 'artifacts'),
    }, provider)

    const state = manager.get('conv-1')

    expect(state.authSnapshotReady).toBe(false)
    expect(state.authCookies).toBeUndefined()
    expect(state.authGeneration).toBe(0)
  })

  it('清除认证状态时撤销旧会话', async () => {
    let cleared = false
    let notifyClear: (() => void | Promise<void>) | undefined
    const provider = {
      getGeneration: () => 0,
      getCookies: () => cleared ? null : [{ name: 'sid', value: 'secret', domain: '.example.com', path: '/', secure: true, httpOnly: true }],
      onClear: (listener: () => void | Promise<void>) => {
        notifyClear = listener
        return () => {}
      },
    }
    const manager = new BrowserSessionManager({
      artifactsPath: path.join(root, 'artifacts'),
    }, provider)
    const first = manager.get('conv-1')

    cleared = true
    await notifyClear?.()

    expect(first.invalidated).toBe(true)
    expect(first.authCookies).toBeUndefined()
    const next = manager.get('conv-1')
    expect(next).not.toBe(first)
    expect(next.authCookies).toBeUndefined()
  })

  function createManager() {
    return new BrowserSessionManager({
      artifactsPath: path.join(root, 'artifacts'),
    })
  }
})
