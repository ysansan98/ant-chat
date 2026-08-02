import type { BrowserIdentityStoreOptions } from '../browserIdentityStore'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserIdentityPaths } from '../../agentBrowser'
import { BrowserIdentityStore } from '../browserIdentityStore'
import type { BrowserProfileSource } from '../browserProfileDiscovery'

describe('browserIdentityStore 行为', () => {
  const roots: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true })
  })

  it('导入成功后只持久化加密状态和来源元数据', async () => {
    const fixture = createFixture()
    const store = new BrowserIdentityStore(fixture.options)
    await store.initialize()

    const status = await store.importSource(fixture.source.sourceId)

    expect(status).toMatchObject({ imported: true, browserName: 'Chromium', profileName: 'Default' })
    expect(await store.listSources()).toEqual([
      { sourceId: 'fixture-source', browserName: 'Chromium', profileName: 'Default', available: true },
    ])
    expect(store.getState()).toMatchObject({ statePath: expect.stringContaining('auth-state.g1.enc'), encryptionKey: expect.any(String) })
    expect(fs.readFileSync(fixture.paths.authStatePath, 'utf8')).toBe('encrypted-state')
    const metadata = JSON.parse(fs.readFileSync(fixture.paths.identityPath, 'utf8')) as Record<string, unknown>
    expect(metadata).toMatchObject({ version: 1, profileDirectory: 'Default' })
    expect(metadata).toHaveProperty('sourceId')
  })

  it('新导入失败时保留旧状态并记录错误', async () => {
    const fixture = createFixture()
    let fail = false
    const options: BrowserIdentityStoreOptions = {
      ...fixture.options,
      runStateSave: async ({ statePath }) => {
        if (fail)
          throw new Error('模拟导出失败')
        fs.writeFileSync(statePath, 'old-encrypted-state')
      },
    }
    const store = new BrowserIdentityStore(options)
    await store.initialize()
    await store.importSource(fixture.source.sourceId)
    const oldMetadata = fs.readFileSync(fixture.paths.identityPath, 'utf8')
    fail = true

    await expect(store.importSource(fixture.source.sourceId)).rejects.toThrow('无法解密源浏览器登录状态')
    expect(fs.readFileSync(fixture.paths.authStatePath, 'utf8')).toBe('old-encrypted-state')
    expect(fs.readFileSync(fixture.paths.identityPath, 'utf8')).toBe(oldMetadata)
    expect((await store.getStatus()).imported).toBe(true)
    expect((await store.getStatus()).error).toContain('无法解密')
  })

  it('成功更新后为新旧 Turn 保留不可变的 generation 状态文件', async () => {
    const fixture = createFixture()
    let stateNumber = 0
    const options: BrowserIdentityStoreOptions = {
      ...fixture.options,
      runStateSave: async ({ statePath }) => {
        stateNumber++
        fs.writeFileSync(statePath, `encrypted-state-${stateNumber}`)
      },
    }
    const store = new BrowserIdentityStore(options)
    await store.initialize()
    await store.importSource(fixture.source.sourceId)
    const oldState = store.getState()!
    await store.importSource(fixture.source.sourceId)
    const newState = store.getState()!

    expect(newState.statePath).not.toBe(oldState.statePath)
    expect(fs.readFileSync(oldState.statePath, 'utf8')).toBe('encrypted-state-1')
    expect(fs.readFileSync(newState.statePath, 'utf8')).toBe('encrypted-state-2')
  })

  function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-identity-'))
    roots.push(root)
    const sourceRoot = path.join(root, 'source')
    const profilePath = path.join(sourceRoot, 'Default')
    fs.mkdirSync(profilePath, { recursive: true })
    fs.writeFileSync(path.join(sourceRoot, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Default' } } } }))
    fs.writeFileSync(path.join(profilePath, 'Cookies'), 'cookie-db')
    const executablePath = path.join(root, 'chromium')
    fs.writeFileSync(executablePath, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(executablePath, 0o755)
    const paths = createBrowserIdentityPaths(root)
    const keyStore = {
      key: null as string | null,
      getBrowserAuthStateKey: async () => keyStore.key,
      saveBrowserAuthStateKey: async (key: string) => { keyStore.key = key },
      deleteBrowserAuthStateKey: async () => { keyStore.key = null },
    }
    const source: BrowserProfileSource = {
      sourceId: 'fixture-source',
      kind: 'chromium',
      browserName: 'Chromium',
      profileName: 'Default',
      userDataDir: sourceRoot,
      profileDirectory: 'Default',
      executablePath,
      available: true,
    }
    const options: BrowserIdentityStoreOptions = {
      paths,
      keyStore,
      discoverSources: async () => [source],
      runStateSave: async ({ statePath }) => fs.writeFileSync(statePath, 'encrypted-state'),
      spawnBrowser: ((_command: string, args: string[]) => {
        const userDataDir = args.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length)
        fs.writeFileSync(path.join(userDataDir, 'DevToolsActivePort'), '9222\n/devtools/browser/test\n')
        const child = new EventEmitter() as EventEmitter & { exitCode: number | null, signalCode: NodeJS.Signals | null, kill: () => boolean }
        child.exitCode = null
        child.signalCode = null
        child.kill = () => {
          child.exitCode = 0
          child.emit('exit', 0, null)
          return true
        }
        return child as never
      }) as unknown as BrowserIdentityStoreOptions['spawnBrowser'],
    }
    return { options, paths, profilePath, source }
  }
})
