import type { BrowserAuthStateProvider, BrowserCookie, BrowserIdentityStatus, BrowserProfileSourceView } from '@ant-chat/shared'
import type { BrowserIdentityPaths } from '../agentBrowser'
import type { SystemLogger } from '../systemLogger'
import type { BrowserCookieImportResult } from './browserCookieImporter'
import type { BrowserProfileSource } from './browserProfileDiscovery'
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { BrowserCookieImportError, importBrowserCookies } from './browserCookieImporter'
import { discoverBrowserProfiles, inspectBrowserDirectory } from './browserProfileDiscovery'

interface BrowserAuthStateKeyStore {
  getBrowserCookieEncryptionKey: () => Promise<string | null>
  saveBrowserCookieEncryptionKey: (key: string) => Promise<void>
  deleteBrowserCookieEncryptionKey: () => Promise<void>
}

interface StoredBrowserIdentity {
  version: 1
  sourceId: string
  kind: BrowserProfileSource['kind']
  browserName: string
  profileName: string
  userDataDir: string
  profileDirectory: string
  executablePath: string
  importedAt: number
  generation: number
}

interface EncryptedCookieFile {
  version: 1
  nonce: string
  tag: string
  ciphertext: string
}

export interface BrowserIdentityStoreOptions {
  paths: BrowserIdentityPaths
  keyStore: BrowserAuthStateKeyStore
  logger?: Pick<SystemLogger, 'info' | 'warn' | 'error'>
  discovery?: Parameters<typeof discoverBrowserProfiles>[0]
  discoverSources?: () => Promise<BrowserProfileSource[]>
  now?: () => number
  importCookies?: (source: BrowserProfileSource) => Promise<BrowserCookieImportResult>
}

export class BrowserIdentityStore implements BrowserAuthStateProvider {
  private current: StoredBrowserIdentity | null = null
  private encryptionKey: string | null = null
  private cookies: BrowserCookie[] | null = null
  private initialized = false
  private generation = 0
  private lastError: string | undefined
  private operation: Promise<unknown> = Promise.resolve()

  private readonly now: () => number
  private readonly importCookies: (source: BrowserProfileSource) => Promise<BrowserCookieImportResult>

  constructor(private readonly options: BrowserIdentityStoreOptions) {
    this.now = options.now ?? Date.now
    this.importCookies = options.importCookies ?? (source => importBrowserCookies(source))
  }

  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.options.paths.root, { recursive: true, mode: 0o700 })
    await fs.promises.chmod(this.options.paths.root, 0o700)
    const raw = await fs.promises.readFile(this.options.paths.identityPath, 'utf8').catch(() => null)
    if (raw) {
      try {
        const value = JSON.parse(raw) as Partial<StoredBrowserIdentity>
        if (value.version !== 1 || !value.sourceId || !value.userDataDir || !value.profileDirectory) {
          throw new Error('identity schema')
        }
        this.current = value as StoredBrowserIdentity
        this.generation = Number.isInteger(value.generation) ? value.generation! : 0
        this.encryptionKey = await this.options.keyStore.getBrowserCookieEncryptionKey()
        if (!this.encryptionKey) {
          this.lastError = '应用托管的浏览器 Cookies 不可用，请重新导入。'
        }
        else {
          const cookiePath = this.getGenerationCookiePath(this.generation)
          try {
            this.cookies = await readEncryptedCookies(cookiePath, this.encryptionKey)
          }
          catch {
            this.lastError = fs.existsSync(this.options.paths.cookiesPath)
              ? '应用托管的浏览器 Cookies 已损坏，请重新导入。'
              : '旧版登录状态不再兼容，请重新导入 Cookies。'
          }
        }
      }
      catch {
        this.current = null
        this.cookies = null
        this.lastError = '浏览器身份记录损坏，请重新导入 Cookies。'
      }
    }
    this.initialized = true
  }

  getCookies(): BrowserCookie[] | null {
    if (!this.initialized || !this.current || !this.encryptionKey || !this.cookies)
      return null
    return this.cookies.map(cookie => ({ ...cookie }))
  }

  getGeneration(): number {
    return this.generation
  }

  async getStatus(): Promise<BrowserIdentityStatus> {
    const state = this.current
    if (!state || !this.getCookies()) {
      return {
        imported: false,
        error: this.lastError,
      }
    }
    return {
      imported: true,
      browserName: state.browserName,
      profileName: state.profileName,
      importedAt: state.importedAt,
      sourceAvailable: await isSourceAvailable(state),
      error: this.lastError,
    }
  }

  async listSources(): Promise<BrowserProfileSourceView[]> {
    const sources = await this.discoverSourceRecords()
    return sources.map(({ sourceId, browserName, profileName, available }): BrowserProfileSourceView => ({ sourceId, browserName, profileName, available }))
  }

  async importSource(sourceId: string): Promise<BrowserIdentityStatus> {
    return await this.runExclusive(async () => {
      const source = (await this.discoverSourceRecords()).find(candidate => candidate.sourceId === sourceId)
        ?? (this.current?.sourceId === sourceId ? toSource(this.current) : undefined)
      if (!source)
        throw new BrowserIdentityError('SOURCE_NOT_FOUND', '找不到所选浏览器 Profile，请刷新列表后重试。')
      return await this.importRecord(source)
    })
  }

  async updateCurrent(): Promise<BrowserIdentityStatus> {
    return await this.runExclusive(async () => {
      if (!this.current)
        throw new BrowserIdentityError('SOURCE_NOT_FOUND', '尚未选择浏览器 Profile。')
      return await this.importRecord(toSource(this.current))
    })
  }

  async importFromDirectory(directory: string): Promise<BrowserIdentityStatus> {
    return await this.runExclusive(async () => {
      try {
        return await this.importRecord(await inspectBrowserDirectory(directory, this.options.discovery))
      }
      catch (error) {
        if (error instanceof BrowserIdentityError)
          throw error
        throw new BrowserIdentityError('SOURCE_INVALID', error instanceof Error ? error.message : '选择的目录不是有效的浏览器 Profile。', error)
      }
    })
  }

  async clear(): Promise<void> {
    await this.runExclusive(async () => {
      await this.clearPersistedState()
      this.current = null
      this.encryptionKey = null
      this.cookies = null
      this.lastError = undefined
      this.generation++
    })
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operation.catch(() => {})
    const current = previous.then(operation)
    this.operation = current
    return await current
  }

  private async importRecord(source: BrowserProfileSource): Promise<BrowserIdentityStatus> {
    this.lastError = undefined
    try {
      const result = await this.importCookies(source)
      const encryptionKey = this.encryptionKey ?? await this.createEncryptionKey()
      await this.persist(source, encryptionKey, result.cookies)
      if (result.failedCount > 0) {
        this.lastError = `已导入 ${result.cookies.length} 个 Cookies，另有 ${result.failedCount} 个无法解密。`
      }
      this.options.logger?.info('浏览器 Cookies 导入完成', {
        browser: source.browserName,
        profile: source.profileName,
        cookieCount: result.cookies.length,
        failedCount: result.failedCount,
      })
      return await this.getStatus()
    }
    catch (error) {
      this.lastError = error instanceof BrowserIdentityError || error instanceof BrowserCookieImportError
        ? error.message
        : '浏览器 Cookies 导入失败，请重试。'
      this.options.logger?.warn('浏览器 Cookies 导入失败', {
        browser: source.browserName,
        profile: source.profileName,
        errorType: error instanceof BrowserIdentityError || error instanceof BrowserCookieImportError ? error.code : 'unknown',
      })
      throw error instanceof BrowserIdentityError
        ? error
        : new BrowserIdentityError(error instanceof BrowserCookieImportError ? error.code : 'IMPORT_FAILED', this.lastError, error)
    }
  }

  private async createEncryptionKey(): Promise<string> {
    const existing = await this.options.keyStore.getBrowserCookieEncryptionKey()
    if (existing)
      return existing
    const key = randomBytes(32).toString('hex')
    await this.options.keyStore.saveBrowserCookieEncryptionKey(key)
    return key
  }

  private async persist(source: BrowserProfileSource, encryptionKey: string, cookies: BrowserCookie[]): Promise<void> {
    const importedAt = this.now()
    const nextGeneration = this.generation + 1
    const metadata: StoredBrowserIdentity = {
      version: 1,
      sourceId: source.sourceId,
      kind: source.kind,
      browserName: source.browserName,
      profileName: source.profileName,
      userDataDir: source.userDataDir,
      profileDirectory: source.profileDirectory,
      executablePath: source.executablePath,
      importedAt,
      generation: nextGeneration,
    }
    const identityTemp = `${this.options.paths.identityPath}.tmp-${randomUUID()}`
    const nextCookiePath = this.getGenerationCookiePath(nextGeneration)
    const nextCookieTemp = `${nextCookiePath}.tmp-${randomUUID()}`
    await fs.promises.writeFile(identityTemp, JSON.stringify(metadata, null, 2), { mode: 0o600 })
    try {
      await writeEncryptedCookies(nextCookieTemp, encryptionKey, cookies)
      await fs.promises.rename(nextCookieTemp, nextCookiePath)
      await replaceFile(this.options.paths.identityPath, identityTemp)
    }
    catch (error) {
      await fs.promises.rm(nextCookieTemp, { force: true })
      await fs.promises.rm(nextCookiePath, { force: true })
      throw error
    }
    finally {
      await fs.promises.rm(identityTemp, { force: true })
    }

    this.current = metadata
    this.encryptionKey = encryptionKey
    this.cookies = cookies.map(cookie => ({ ...cookie }))
    this.generation = nextGeneration

    // 这是当前版本的便捷索引；真正保证旧 Turn 隔离的是 generation 文件和 identity 指针。
    const currentCookieTemp = `${this.options.paths.cookiesPath}.tmp-${randomUUID()}`
    try {
      await fs.promises.copyFile(nextCookiePath, currentCookieTemp)
      await fs.promises.chmod(currentCookieTemp, 0o600)
      await replaceFile(this.options.paths.cookiesPath, currentCookieTemp)
    }
    catch {
      await fs.promises.rm(currentCookieTemp, { force: true })
      this.options.logger?.warn('浏览器当前 Cookies 索引更新失败', {
        browser: source.browserName,
        profile: source.profileName,
        errorType: 'current-cookie-index',
      })
    }
  }

  private async discoverSourceRecords(): Promise<BrowserProfileSource[]> {
    return await (this.options.discoverSources?.() ?? discoverBrowserProfiles(this.options.discovery))
  }

  private getGenerationCookiePath(generation: number): string {
    return path.join(this.options.paths.root, `cookies.g${generation}.enc`)
  }

  private async clearPersistedState(): Promise<void> {
    const backupRoot = await fs.promises.mkdtemp(path.join(this.options.paths.root, `.clear-${randomUUID()}-`))
    await fs.promises.chmod(backupRoot, 0o700)
    const targets = await this.getManagedFilePaths()
    const moved: Array<{ targetPath: string, backupPath: string }> = []
    let keyDeleted = false
    try {
      for (const targetPath of targets) {
        if (!fs.existsSync(targetPath))
          continue
        const backupPath = path.join(backupRoot, path.basename(targetPath))
        await fs.promises.rename(targetPath, backupPath)
        moved.push({ targetPath, backupPath })
      }
      await this.options.keyStore.deleteBrowserCookieEncryptionKey()
      keyDeleted = true
    }
    catch (error) {
      if (!keyDeleted) {
        for (const { targetPath, backupPath } of [...moved].reverse()) {
          await fs.promises.rename(backupPath, targetPath).catch(() => {})
        }
      }
      throw error
    }
    finally {
      await fs.promises.rm(backupRoot, { recursive: true, force: true }).catch(() => {
        this.options.logger?.warn('浏览器 Cookies 清理临时目录失败', { errorType: 'clear-temp-cleanup' })
      })
    }
  }

  private async getManagedFilePaths(): Promise<string[]> {
    const entries = await fs.promises.readdir(this.options.paths.root).catch(() => [])
    return [
      this.options.paths.identityPath,
      this.options.paths.cookiesPath,
      ...entries
        .filter(entry => /^cookies\.g\d+\.enc$/.test(entry))
        .map(entry => path.join(this.options.paths.root, entry)),
    ]
  }
}

export class BrowserIdentityError extends Error {
  constructor(readonly code: string, message: string, options?: unknown) {
    super(message)
    if (options !== undefined)
      Object.defineProperty(this, 'cause', { configurable: true, value: options })
    this.name = 'BrowserIdentityError'
  }
}

function toSource(identity: StoredBrowserIdentity): BrowserProfileSource {
  return { ...identity, available: process.platform === 'darwin' }
}

async function isSourceAvailable(identity: StoredBrowserIdentity): Promise<boolean> {
  if (process.platform !== 'darwin')
    return false
  const profilePath = path.join(identity.userDataDir, identity.profileDirectory)
  const profile = await fs.promises.stat(profilePath).catch(() => null)
  if (!profile?.isDirectory())
    return false
  for (const cookiePath of [path.join(profilePath, 'Network', 'Cookies'), path.join(profilePath, 'Cookies')]) {
    const cookieStat = await fs.promises.stat(cookiePath).catch(() => null)
    if (cookieStat?.isFile())
      return true
  }
  return false
}

async function writeEncryptedCookies(filePath: string, encryptionKey: string, cookies: BrowserCookie[]): Promise<void> {
  const key = deriveEncryptionKey(encryptionKey)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const plaintext = Buffer.from(JSON.stringify({ version: 1, cookies }), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const payload: EncryptedCookieFile = {
    version: 1,
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
  await fs.promises.writeFile(filePath, JSON.stringify(payload), { mode: 0o600 })
  await fs.promises.chmod(filePath, 0o600)
}

async function readEncryptedCookies(filePath: string, encryptionKey: string): Promise<BrowserCookie[]> {
  const value = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as Partial<EncryptedCookieFile>
  if (value.version !== 1 || !value.nonce || !value.tag || !value.ciphertext)
    throw new Error('cookie envelope schema')
  const decipher = createDecipheriv('aes-256-gcm', deriveEncryptionKey(encryptionKey), Buffer.from(value.nonce, 'base64'))
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ])
  const parsed = JSON.parse(plaintext.toString('utf8')) as { version?: number, cookies?: unknown }
  if (parsed.version !== 1 || !Array.isArray(parsed.cookies) || !parsed.cookies.every(isBrowserCookie))
    throw new Error('cookie payload schema')
  return parsed.cookies
}

function deriveEncryptionKey(value: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(value))
    return Buffer.from(value, 'hex')
  return createHash('sha256').update(value).digest()
}

function isBrowserCookie(value: unknown): value is BrowserCookie {
  if (!value || typeof value !== 'object')
    return false
  const cookie = value as Partial<BrowserCookie>
  return typeof cookie.name === 'string'
    && typeof cookie.value === 'string'
    && typeof cookie.domain === 'string'
    && typeof cookie.path === 'string'
    && typeof cookie.secure === 'boolean'
    && typeof cookie.httpOnly === 'boolean'
    && (cookie.sameSite === undefined || cookie.sameSite === 'Strict' || cookie.sameSite === 'Lax' || cookie.sameSite === 'None')
    && (cookie.expires === undefined || typeof cookie.expires === 'number')
}

async function replaceFile(targetPath: string, temporaryPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 })
  const backupPath = `${targetPath}.bak-${randomUUID()}`
  const oldTarget = fs.existsSync(targetPath)
  try {
    if (oldTarget)
      await fs.promises.rename(targetPath, backupPath)
    await fs.promises.rename(temporaryPath, targetPath)
    await fs.promises.rm(backupPath, { force: true })
  }
  catch (error) {
    await fs.promises.rm(targetPath, { force: true })
    if (oldTarget)
      await fs.promises.rename(backupPath, targetPath).catch(() => {})
    throw error
  }
}
