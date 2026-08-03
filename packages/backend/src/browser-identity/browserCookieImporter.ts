import type { BrowserCookie } from '@ant-chat/shared'
import type { BrowserProfileSource } from './browserProfileDiscovery'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const CHROME_EPOCH_MICROSECONDS = 11_644_473_600_000_000
const COOKIE_IMPORT_TIMEOUT_MS = 15_000

export interface ChromiumCookieRow {
  host_key?: string
  name?: string
  value?: string
  encrypted_value?: Uint8Array | string | null
  path?: string
  expires_utc?: number | bigint | null
  is_secure?: number | boolean | null
  is_httponly?: number | boolean | null
  samesite?: number | null
}

export interface BrowserCookieImportResult {
  cookies: BrowserCookie[]
  failedCount: number
}

export interface BrowserCookieImporterOptions {
  platform?: NodeJS.Platform
  tempDirectory?: string
  readKeychainPassword?: (source: BrowserProfileSource) => Promise<string>
  readCookieRows?: (cookieDatabasePath: string) => Promise<ChromiumCookieRow[]>
}

export class BrowserCookieImportError extends Error {
  constructor(readonly code: string, message: string, options?: unknown) {
    super(message)
    if (options !== undefined)
      Object.defineProperty(this, 'cause', { configurable: true, value: options })
    this.name = 'BrowserCookieImportError'
  }
}

/**
 * 直接读取 Chromium Cookies 数据库。源浏览器进程不会被启动，复制只发生在
 * 0700 临时目录中，且数据库和 WAL/SHM 文件在 finally 中删除。
 */
export async function importBrowserCookies(
  source: BrowserProfileSource,
  options: BrowserCookieImporterOptions = {},
): Promise<BrowserCookieImportResult> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    throw new BrowserCookieImportError('PLATFORM_UNSUPPORTED', '当前版本只支持在 macOS 上导入 Chrome、Edge、Chromium 或 Brave Cookies。')
  }

  const sourceDatabasePath = await findCookieDatabase(source)
  if (!sourceDatabasePath) {
    throw new BrowserCookieImportError('COOKIES_DB_MISSING', '找不到该 Profile 的 Cookies 数据库，请确认浏览器已经创建过该 Profile。')
  }

  const password = await (options.readKeychainPassword ?? readKeychainPassword)(source)
  const temporaryRoot = await fs.promises.mkdtemp(path.join(options.tempDirectory ?? os.tmpdir(), 'ant-chat-cookie-import-'))
  await fs.promises.chmod(temporaryRoot, 0o700)
  const temporaryDatabasePath = path.join(temporaryRoot, 'Cookies')
  try {
    await fs.promises.copyFile(sourceDatabasePath, temporaryDatabasePath)
    await copySidecar(sourceDatabasePath, temporaryDatabasePath, '-wal')
    await copySidecar(sourceDatabasePath, temporaryDatabasePath, '-shm')
    const rows = await (options.readCookieRows ?? readCookieRows)(temporaryDatabasePath)
    const cookies: BrowserCookie[] = []
    let failedCount = 0
    for (const row of rows) {
      const cookie = decryptCookieRow(row, password)
      if (!cookie) {
        failedCount++
        continue
      }
      cookies.push(cookie)
    }
    if (failedCount > 0 && cookies.length === 0 && rows.length > 0) {
      throw new BrowserCookieImportError('DECRYPT_FAILED', '无法解密源浏览器 Cookies。请确认当前 macOS 用户可以访问浏览器钥匙串后重试。')
    }
    return { cookies, failedCount }
  }
  catch (error) {
    if (error instanceof BrowserCookieImportError)
      throw error
    throw new BrowserCookieImportError('READ_FAILED', '读取源浏览器 Cookies 失败，请确认浏览器 Profile 未损坏后重试。', error)
  }
  finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
  }
}

export function decryptChromiumCookieValue(
  encryptedValue: Uint8Array | string | null | undefined,
  safeStoragePassword: string,
  hostKey: string,
): string | null {
  const encrypted = toBuffer(encryptedValue)
  if (!encrypted || encrypted.length === 0)
    return null
  if (!encrypted.subarray(0, 3).equals(Buffer.from('v10')) && !encrypted.subarray(0, 3).equals(Buffer.from('v11')))
    return null

  try {
    const key = pbkdf2Sync(safeStoragePassword, 'saltysalt', 1003, 16, 'sha1')
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
    const decrypted = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()])
    const hostHash = createHash('sha256').update(hostKey).digest()
    const hasHostHash = hostHash.equals(decrypted.subarray(0, hostHash.length))
    return (hasHostHash ? decrypted.subarray(hostHash.length) : decrypted).toString('utf8')
  }
  catch {
    return null
  }
}

async function findCookieDatabase(source: BrowserProfileSource): Promise<string | null> {
  const profilePath = path.join(source.userDataDir, source.profileDirectory)
  for (const relativePath of [path.join('Network', 'Cookies'), 'Cookies']) {
    const candidate = path.join(profilePath, relativePath)
    const stat = await fs.promises.stat(candidate).catch(() => null)
    if (stat?.isFile())
      return candidate
  }
  return null
}

async function readKeychainPassword(source: BrowserProfileSource): Promise<string> {
  const config = getKeychainConfig(source.kind)
  try {
    const result = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      config.service,
      '-a',
      config.account,
      '-w',
    ], {
      timeout: COOKIE_IMPORT_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    })
    const password = String(result.stdout).trim()
    if (!password)
      throw new Error('empty keychain value')
    return password
  }
  catch (error) {
    throw new BrowserCookieImportError('KEYCHAIN_UNAVAILABLE', `无法读取 ${source.browserName} 的 macOS 钥匙串密钥，请解锁钥匙串后重试。`, error)
  }
}

async function readCookieRows(cookieDatabasePath: string): Promise<ChromiumCookieRow[]> {
  try {
    const require = createRequire(import.meta.url)
    const loaded = require('better-sqlite3') as { default?: new (path: string, options: { readonly: boolean, fileMustExist: boolean }) => unknown } | (new (path: string, options: { readonly: boolean, fileMustExist: boolean }) => unknown)
    const Database = typeof loaded === 'function' ? loaded : loaded.default
    if (!Database)
      throw new Error('better-sqlite3 unavailable')
    const database = new Database(cookieDatabasePath, { readonly: true, fileMustExist: true }) as { prepare: (sql: string) => { all: () => ChromiumCookieRow[] }, close: () => void }
    try {
      return database.prepare(`
        SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite
        FROM cookies
      `).all()
    }
    finally {
      database.close()
    }
  }
  catch (error) {
    throw new BrowserCookieImportError('SQLITE_UNAVAILABLE', '无法读取源浏览器 Cookies 数据库，请关闭浏览器后重试。', error)
  }
}

function decryptCookieRow(row: ChromiumCookieRow, safeStoragePassword: string): BrowserCookie | null {
  const hostKey = typeof row.host_key === 'string' ? row.host_key : ''
  const name = typeof row.name === 'string' ? row.name : ''
  if (!hostKey || !name)
    return null

  const value = typeof row.value === 'string' && row.value.length > 0
    ? row.value
    : decryptChromiumCookieValue(row.encrypted_value, safeStoragePassword, hostKey)
  if (value === null || value === undefined)
    return null

  const expires = toUnixSeconds(row.expires_utc)
  const cookie: BrowserCookie = {
    name,
    value,
    domain: hostKey,
    path: typeof row.path === 'string' && row.path ? row.path : '/',
    secure: Boolean(row.is_secure),
    httpOnly: Boolean(row.is_httponly),
  }
  const sameSite = toSameSite(row.samesite)
  if (sameSite)
    cookie.sameSite = sameSite
  if (expires !== undefined)
    cookie.expires = expires
  return cookie
}

function toBuffer(value: Uint8Array | string | null | undefined): Buffer | null {
  if (value instanceof Uint8Array)
    return Buffer.from(value)
  if (typeof value === 'string' && value)
    return Buffer.from(value, 'binary')
  return null
}

function toUnixSeconds(value: number | bigint | null | undefined): number | undefined {
  if (value === null || value === undefined)
    return undefined
  const microseconds = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isFinite(microseconds) || microseconds <= CHROME_EPOCH_MICROSECONDS)
    return undefined
  return Math.floor((microseconds - CHROME_EPOCH_MICROSECONDS) / 1_000_000)
}

function toSameSite(value: number | null | undefined): BrowserCookie['sameSite'] {
  if (value === 1)
    return 'Lax'
  if (value === 2)
    return 'Strict'
  if (value === 0)
    return 'None'
  return undefined
}

function getKeychainConfig(kind: BrowserProfileSource['kind']): { service: string, account: string } {
  switch (kind) {
    case 'edge':
      return { service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' }
    case 'chromium':
      return { service: 'Chromium Safe Storage', account: 'Chromium' }
    case 'brave':
      return { service: 'Brave Safe Storage', account: 'Brave' }
    case 'chrome':
      return { service: 'Chrome Safe Storage', account: 'Chrome' }
  }
}

async function copySidecar(sourcePath: string, targetPath: string, suffix: string): Promise<void> {
  await fs.promises.copyFile(`${sourcePath}${suffix}`, `${targetPath}${suffix}`).catch(() => {})
}
