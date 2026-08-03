import type { BrowserProfileSource } from '../browserProfileDiscovery'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decryptChromiumCookieValue, importBrowserCookies } from '../browserCookieImporter'

describe('browserCookieImporter 行为', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true })
  })

  it('读取临时 Cookies 副本并解密 v10 Cookie，完成后清理临时目录', async () => {
    const fixture = createFixture()
    const safeStoragePassword = 'safe-storage-password'
    const encryptedValue = encryptCookie('.example.com', 'token-value', safeStoragePassword)

    const result = await importBrowserCookies(fixture.source, {
      platform: 'darwin',
      tempDirectory: fixture.root,
      readKeychainPassword: async () => safeStoragePassword,
      readCookieRows: async (cookieDatabasePath) => {
        expect(cookieDatabasePath).not.toBe(path.join(fixture.source.userDataDir, fixture.source.profileDirectory, 'Network', 'Cookies'))
        expect(fs.existsSync(cookieDatabasePath)).toBe(true)
        return [{
          host_key: '.example.com',
          name: 'session',
          value: '',
          encrypted_value: encryptedValue,
          path: '/',
          expires_utc: 11_644_473_601_000_000,
          is_secure: 1,
          is_httponly: 1,
          samesite: 1,
        }]
      },
    })

    expect(result).toEqual({
      cookies: [{
        name: 'session',
        value: 'token-value',
        domain: '.example.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
        expires: 1,
      }],
      failedCount: 0,
    })
    expect(fs.readdirSync(fixture.root).filter(entry => entry.startsWith('ant-chat-cookie-import-'))).toEqual([])
  })

  it('保留可读明文值并统计无法解密的行，不把失败行伪装成空 Cookie', async () => {
    const fixture = createFixture()
    const result = await importBrowserCookies(fixture.source, {
      platform: 'darwin',
      tempDirectory: fixture.root,
      readKeychainPassword: async () => 'safe-storage-password',
      readCookieRows: async () => [
        { host_key: '.example.com', name: 'plain', value: 'plain-value', encrypted_value: null, path: '/', is_secure: 0, is_httponly: 0 },
        { host_key: '.example.com', name: 'broken', value: '', encrypted_value: Buffer.from('not-a-chrome-value'), path: '/' },
      ],
    })

    expect(result.cookies).toHaveLength(1)
    expect(result.cookies[0]).toMatchObject({ name: 'plain', value: 'plain-value' })
    expect(result.failedCount).toBe(1)
  })

  it('缺少 Cookies 数据库时明确失败', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-cookie-missing-'))
    roots.push(root)
    const source = createSource(root)

    await expect(importBrowserCookies(source, { platform: 'darwin', readKeychainPassword: async () => 'unused' }))
      .rejects
      .toThrow('找不到该 Profile 的 Cookies 数据库')
  })

  it('支持 Chromium v10 解密结果带 host hash 前缀', () => {
    const encrypted = encryptCookie('.example.com', 'value', 'password')
    expect(decryptChromiumCookieValue(encrypted, 'password', '.example.com')).toBe('value')
  })

  function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-cookie-importer-'))
    roots.push(root)
    const source = createSource(root)
    fs.mkdirSync(path.join(source.userDataDir, source.profileDirectory, 'Network'), { recursive: true })
    fs.writeFileSync(path.join(source.userDataDir, source.profileDirectory, 'Network', 'Cookies'), 'sqlite-fixture')
    return { root, source }
  }
})

function createSource(root: string): BrowserProfileSource {
  return {
    sourceId: 'fixture-source',
    kind: 'chrome',
    browserName: 'Chrome',
    profileName: 'Default',
    userDataDir: root,
    profileDirectory: 'Default',
    executablePath: '',
    available: true,
  }
}

function encryptCookie(hostKey: string, value: string, safeStoragePassword: string): Buffer {
  const key = crypto.pbkdf2Sync(safeStoragePassword, 'saltysalt', 1003, 16, 'sha1')
  const cipher = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
  const plaintext = Buffer.concat([crypto.createHash('sha256').update(hostKey).digest(), Buffer.from(value)])
  return Buffer.concat([Buffer.from('v10'), cipher.update(plaintext), cipher.final()])
}
