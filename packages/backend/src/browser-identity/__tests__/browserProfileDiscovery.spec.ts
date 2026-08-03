import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverBrowserProfiles, inspectBrowserDirectory } from '../browserProfileDiscovery'

describe('浏览器 Profile 自动发现', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true })
  })

  it('读取 Local State 和多个 Profile，并隐藏本地路径', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-discovery-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({
      profile: {
        info_cache: {
          'Default': { name: '工作账号' },
          'Profile 1': { user_name: '个人账号' },
        },
      },
    }))
    fs.mkdirSync(path.join(root, 'Default'), { recursive: true })
    fs.mkdirSync(path.join(root, 'Profile 1'), { recursive: true })

    const sources = await discoverBrowserProfiles({ platform: 'darwin', extraDirectories: [root] })
    const first = sources.find(source => source.profileName === '工作账号')!
    const second = sources.find(source => source.profileName === '个人账号')!

    expect(first).toMatchObject({ browserName: 'Chromium', profileName: '工作账号', available: true })
    expect(second).toMatchObject({ browserName: 'Chromium', profileName: '个人账号', available: true })
    expect(first.sourceId).toMatch(/^[a-f0-9]{24}$/)
  })

  it('忽略损坏的 Local State，但仍发现目录名规范的 Profile', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-discovery-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'Local State'), '{broken')
    fs.mkdirSync(path.join(root, 'Default'), { recursive: true })
    fs.mkdirSync(path.join(root, 'Not a Profile'), { recursive: true })

    const sources = await discoverBrowserProfiles({ extraDirectories: [root] })
    expect(sources.filter(source => source.userDataDir === root)).toEqual([
      expect.objectContaining({ profileName: 'Default' }),
    ])
  })

  it('发现 macOS 下的 Chrome、Edge、Chromium 和 Brave 数据目录', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-discovery-'))
    roots.push(root)
    const directories = [
      'Google/Chrome',
      'Microsoft Edge',
      'Chromium',
      'BraveSoftware/Brave-Browser',
    ]
    for (const directory of directories) {
      const userDataDir = path.join(root, 'Library/Application Support', directory)
      fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true })
    }

    const sources = await discoverBrowserProfiles({ platform: 'darwin', homeDir: root })

    expect(new Set(sources.map(source => source.browserName))).toEqual(new Set(['Chrome', 'Edge', 'Chromium', 'Brave']))
  })

  it('手动选择自定义 Profile 时可从 PATH 找到对应浏览器', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-discovery-'))
    roots.push(root)
    const profilePath = path.join(root, 'Profile 1')
    fs.mkdirSync(profilePath, { recursive: true })
    const executable = path.join(root, 'chromium')
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(executable, 0o755)

    const source = await inspectBrowserDirectory(profilePath, { platform: 'darwin', env: { PATH: root } })

    expect(source).toMatchObject({ browserName: 'Chromium', profileDirectory: 'Profile 1', executablePath: executable, available: true })
  })

  it('在当前版本不支持的平台标记来源不可用', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-discovery-'))
    roots.push(root)
    fs.mkdirSync(path.join(root, 'Default'), { recursive: true })

    const source = await inspectBrowserDirectory(root, { platform: 'linux' })

    expect(source.available).toBe(false)
  })
})
