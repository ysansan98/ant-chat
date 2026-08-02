import type { BrowserCookie } from '@ant-chat/shared'
import type { BrowserIdentityStoreOptions } from '../browserIdentityStore'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBrowserIdentityPaths } from '../../agentBrowser'
import { BrowserIdentityStore } from '../browserIdentityStore'
import type { BrowserProfileSource } from '../browserProfileDiscovery'

describe('browserIdentityStore 行为', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true })
  })

  it('导入成功后只持久化加密 Cookies 和来源元数据', async () => {
    const fixture = createFixture()
    const store = new BrowserIdentityStore(fixture.options)
    await store.initialize()

    const status = await store.importSource(fixture.source.sourceId)

    expect(status).toMatchObject({ imported: true, browserName: 'Chromium', profileName: 'Default' })
    expect(await store.listSources()).toEqual([
      { sourceId: 'fixture-source', browserName: 'Chromium', profileName: 'Default', available: true },
    ])
    expect(store.getCookies()).toEqual(fixture.cookies)
    expect(fs.readFileSync(fixture.paths.cookiesPath, 'utf8')).not.toContain('cookie-secret')
    const metadata = JSON.parse(fs.readFileSync(fixture.paths.identityPath, 'utf8')) as Record<string, unknown>
    expect(metadata).toMatchObject({ version: 1, profileDirectory: 'Default' })
    expect(metadata).toHaveProperty('sourceId')
  })

  it('应用重启后从加密 Cookies 恢复运行时 provider', async () => {
    const fixture = createFixture()
    const store = new BrowserIdentityStore(fixture.options)
    await store.initialize()
    await store.importSource(fixture.source.sourceId)

    const restored = new BrowserIdentityStore(fixture.options)
    await restored.initialize()

    expect(restored.getCookies()).toEqual(fixture.cookies)
    expect((await restored.getStatus()).imported).toBe(true)
  })

  it('新导入失败时保留旧 Cookies 和来源记录', async () => {
    const fixture = createFixture()
    let fail = false
    const options: BrowserIdentityStoreOptions = {
      ...fixture.options,
      importCookies: async () => {
        if (fail)
          throw new Error('模拟读取失败')
        return { cookies: fixture.cookies, failedCount: 0 }
      },
    }
    const store = new BrowserIdentityStore(options)
    await store.initialize()
    await store.importSource(fixture.source.sourceId)
    const oldMetadata = fs.readFileSync(fixture.paths.identityPath, 'utf8')
    const oldCookies = fs.readFileSync(fixture.paths.cookiesPath, 'utf8')
    fail = true

    await expect(store.importSource(fixture.source.sourceId)).rejects.toThrow('浏览器 Cookies 导入失败')
    expect(store.getCookies()).toEqual(fixture.cookies)
    expect(fs.readFileSync(fixture.paths.cookiesPath, 'utf8')).toBe(oldCookies)
    expect(fs.readFileSync(fixture.paths.identityPath, 'utf8')).toBe(oldMetadata)
    expect((await store.getStatus()).imported).toBe(true)
    expect((await store.getStatus()).error).toContain('浏览器 Cookies 导入失败')
  })

  it('更新导入后按 generation 保存新旧 Cookies 快照', async () => {
    const fixture = createFixture()
    let importNumber = 0
    const options: BrowserIdentityStoreOptions = {
      ...fixture.options,
      importCookies: async () => {
        importNumber++
        return {
          cookies: [{ ...fixture.cookies[0]!, value: `cookie-${importNumber}` }],
          failedCount: 0,
        }
      },
    }
    const store = new BrowserIdentityStore(options)
    await store.initialize()
    await store.importSource(fixture.source.sourceId)
    await store.importSource(fixture.source.sourceId)

    expect(store.getCookies()?.[0]?.value).toBe('cookie-2')
    expect(fs.existsSync(path.join(fixture.paths.root, 'cookies.g1.enc'))).toBe(true)
    expect(fs.existsSync(path.join(fixture.paths.root, 'cookies.g2.enc'))).toBe(true)
    expect(fs.readFileSync(path.join(fixture.paths.root, 'cookies.g1.enc'), 'utf8')).not.toBe(fs.readFileSync(path.join(fixture.paths.root, 'cookies.g2.enc'), 'utf8'))
  })

  it('清除时只删除应用托管 Cookies，不触碰源 Profile', async () => {
    const fixture = createFixture()
    const store = new BrowserIdentityStore(fixture.options)
    await store.initialize()
    await store.importSource(fixture.source.sourceId)

    await store.clear()

    expect(store.getCookies()).toBeNull()
    expect((await store.getStatus()).imported).toBe(false)
    expect(fs.existsSync(fixture.paths.cookiesPath)).toBe(false)
    expect(fs.existsSync(path.join(fixture.source.userDataDir, fixture.source.profileDirectory, 'Cookies'))).toBe(true)
  })

  it('清除失败时恢复应用托管文件和运行时 Cookies', async () => {
    const fixture = createFixture()
    const store = new BrowserIdentityStore(fixture.options)
    await store.initialize()
    await store.importSource(fixture.source.sourceId)
    const identity = fs.readFileSync(fixture.paths.identityPath, 'utf8')
    const cookies = fs.readFileSync(fixture.paths.cookiesPath, 'utf8')
    fixture.keyStore.failDelete = true

    await expect(store.clear()).rejects.toThrow('模拟清除失败')

    expect(store.getCookies()).toEqual(fixture.cookies)
    expect(fs.readFileSync(fixture.paths.identityPath, 'utf8')).toBe(identity)
    expect(fs.readFileSync(fixture.paths.cookiesPath, 'utf8')).toBe(cookies)
  })

  function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-identity-'))
    roots.push(root)
    const sourceRoot = path.join(root, 'source')
    const profilePath = path.join(sourceRoot, 'Default')
    fs.mkdirSync(profilePath, { recursive: true })
    fs.writeFileSync(path.join(sourceRoot, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Default' } } } }))
    fs.writeFileSync(path.join(profilePath, 'Cookies'), 'source-cookie-db')
    const paths = createBrowserIdentityPaths(root)
    const keyStore = {
      key: null as string | null,
      failDelete: false,
      getBrowserCookieEncryptionKey: async () => keyStore.key,
      saveBrowserCookieEncryptionKey: async (key: string) => { keyStore.key = key },
      deleteBrowserCookieEncryptionKey: async () => {
        if (keyStore.failDelete)
          throw new Error('模拟清除失败')
        keyStore.key = null
      },
    }
    const source: BrowserProfileSource = {
      sourceId: 'fixture-source',
      kind: 'chromium',
      browserName: 'Chromium',
      profileName: 'Default',
      userDataDir: sourceRoot,
      profileDirectory: 'Default',
      executablePath: '',
      available: true,
    }
    const cookies: BrowserCookie[] = [{
      name: 'sid',
      value: 'cookie-secret',
      domain: '.example.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    }]
    const options: BrowserIdentityStoreOptions = {
      paths,
      keyStore,
      discoverSources: async () => [source],
      importCookies: async () => ({ cookies, failedCount: 0 }),
    }
    return { options, paths, source, cookies, keyStore }
  }
})
