import type { BrowserAuthStateProvider, BrowserIdentityStatus, BrowserProfileSourceView } from '@ant-chat/shared'
import type { BrowserIdentityPaths } from '../agentBrowser'
import type { SystemLogger } from '../systemLogger'
import type { BrowserProfileSource } from './browserProfileDiscovery'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { discoverBrowserProfiles, inspectBrowserDirectory } from './browserProfileDiscovery'

interface BrowserAuthStateKeyStore {
  getBrowserAuthStateKey: () => Promise<string | null>
  saveBrowserAuthStateKey: (key: string) => Promise<void>
  deleteBrowserAuthStateKey: () => Promise<void>
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

export interface BrowserIdentityStoreOptions {
  paths: BrowserIdentityPaths
  keyStore: BrowserAuthStateKeyStore
  logger?: Pick<SystemLogger, 'info' | 'warn' | 'error'>
  commandEnvironment?: NodeJS.ProcessEnv
  discovery?: Parameters<typeof discoverBrowserProfiles>[0]
  discoverSources?: () => Promise<BrowserProfileSource[]>
  now?: () => number
  spawnBrowser?: typeof spawn
  runStateSave?: (input: { endpoint: string, statePath: string, encryptionKey: string, env: NodeJS.ProcessEnv }) => Promise<void>
}

const IMPORT_TIMEOUT_MS = 30_000
export class BrowserIdentityStore implements BrowserAuthStateProvider {
  private current: StoredBrowserIdentity | null = null
  private encryptionKey: string | null = null
  private initialized = false
  private generation = 0
  private lastError: string | undefined
  private operation: Promise<unknown> = Promise.resolve()

  private readonly now: () => number
  private readonly spawnBrowser: typeof spawn

  constructor(private readonly options: BrowserIdentityStoreOptions) {
    this.now = options.now ?? Date.now
    this.spawnBrowser = options.spawnBrowser ?? spawn
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
        this.encryptionKey = await this.options.keyStore.getBrowserAuthStateKey()
        const generationStatePath = this.getGenerationStatePath(this.generation)
        if (!this.encryptionKey) {
          this.lastError = '应用托管的浏览器登录状态不可用，请重新导入。'
        }
        else if (!fs.existsSync(generationStatePath) && fs.existsSync(this.options.paths.authStatePath)) {
          await this.snapshotCurrentState(this.generation)
        }
        else if (!fs.existsSync(generationStatePath)) {
          this.lastError = '应用托管的浏览器登录状态不可用，请重新导入。'
        }
      }
      catch {
        this.current = null
        this.lastError = '浏览器登录状态记录损坏，请重新导入。'
      }
    }
    this.initialized = true
  }

  getState(): { statePath: string, encryptionKey: string } | null {
    const statePath = this.getGenerationStatePath(this.generation)
    if (!this.initialized || !this.current || !this.encryptionKey || !fs.existsSync(statePath))
      return null
    return { statePath, encryptionKey: this.encryptionKey }
  }

  getGeneration(): number {
    return this.generation
  }

  async getStatus(): Promise<BrowserIdentityStatus> {
    const state = this.current
    if (!state || !this.getState()) {
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
    return await this.runExclusive(async () => this.importRecord(await inspectBrowserDirectory(directory, this.options.discovery)))
  }

  private async discoverSourceRecords(): Promise<BrowserProfileSource[]> {
    return await (this.options.discoverSources?.() ?? discoverBrowserProfiles(this.options.discovery))
  }

  async clear(): Promise<void> {
    await this.runExclusive(async () => {
      await this.options.keyStore.deleteBrowserAuthStateKey()
      await Promise.all([
        fs.promises.rm(this.options.paths.authStatePath, { force: true }),
        fs.promises.rm(this.options.paths.identityPath, { force: true }),
        this.removeGenerationStates(),
      ])
      this.current = null
      this.encryptionKey = null
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
      const encryptionKey = this.encryptionKey ?? await this.createEncryptionKey()
      const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-chat-browser-import-'))
      await fs.promises.chmod(temporaryRoot, 0o700)
      try {
        const usedExistingCdp = await this.tryExistingCdp(source, temporaryRoot, encryptionKey)
        const statePath = path.join(temporaryRoot, 'auth-state.enc')
        if (!usedExistingCdp) {
          await this.importFromSourceProfile(source, statePath, encryptionKey)
        }
        await fs.promises.chmod(statePath, 0o600)
        await this.persist(source, encryptionKey, statePath)
      }
      finally {
        await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
      }
      this.lastError = undefined
      return await this.getStatus()
    }
    catch (error) {
      this.lastError = error instanceof BrowserIdentityError ? error.message : '浏览器登录状态导入失败，请重试。'
      this.options.logger?.warn('浏览器登录状态导入失败', {
        browser: source.browserName,
        profile: source.profileName,
        errorType: error instanceof BrowserIdentityError ? error.code : 'unknown',
      })
      throw error instanceof BrowserIdentityError
        ? error
        : new BrowserIdentityError('IMPORT_FAILED', this.lastError, error)
    }
  }

  private async createEncryptionKey(): Promise<string> {
    const existing = await this.options.keyStore.getBrowserAuthStateKey()
    if (existing)
      return existing
    const key = randomBytes(32).toString('hex')
    await this.options.keyStore.saveBrowserAuthStateKey(key)
    return key
  }

  private async tryExistingCdp(source: BrowserProfileSource, temporaryRoot: string, encryptionKey: string): Promise<boolean> {
    const endpoint = await readDevToolsEndpoint(source.userDataDir)
    if (!endpoint)
      return false
    try {
      await this.runStateSave({ endpoint, statePath: path.join(temporaryRoot, 'auth-state.enc'), encryptionKey })
      return true
    }
    catch (error) {
      if (hasBrowserLock(source.userDataDir)) {
        throw new BrowserIdentityError('CDP_UNAVAILABLE', '源浏览器正在运行，但无法连接调试接口。请完全退出浏览器后重试。', error)
      }
      return false
    }
  }

  /**
   * 关闭源浏览器时仍由它自己打开原 Profile 并通过 CDP 导出。
   * 不能把 Cookies 数据库复制到临时目录：Chromium 的 App-Bound 加密可能绑定
   * 原始 Profile 和浏览器进程，复制后既可能失效，也会扩大敏感数据接触面。
   */
  private async importFromSourceProfile(source: BrowserProfileSource, statePath: string, encryptionKey: string): Promise<void> {
    if (!source.executablePath) {
      throw new BrowserIdentityError('BROWSER_UNAVAILABLE', `找不到${source.browserName}可执行文件，请关闭浏览器后重试或使用手动选择。`)
    }
    if (hasBrowserLock(source.userDataDir)) {
      throw new BrowserIdentityError('SOURCE_RUNNING', '源浏览器正在运行。请完全退出源浏览器后再更新导入。')
    }

    const startedAt = Date.now()
    const processHandle = this.spawnBrowser(source.executablePath, [
      `--user-data-dir=${source.userDataDir}`,
      `--profile-directory=${source.profileDirectory}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ], { detached: process.platform !== 'win32', stdio: 'ignore', env: { ...process.env, ...this.options.commandEnvironment } })
    try {
      const endpoint = await waitForDevToolsEndpoint(source.userDataDir, startedAt)
      await this.runStateSave({ endpoint, statePath, encryptionKey })
    }
    catch (error) {
      if (error instanceof BrowserIdentityError)
        throw error
      throw new BrowserIdentityError('DECRYPT_FAILED', '无法解密源浏览器登录状态。请先关闭浏览器，确认该 Profile 能正常打开后重试。', error)
    }
    finally {
      await terminateProcess(processHandle)
    }
  }

  private async runStateSave(input: { endpoint: string, statePath: string, encryptionKey: string }): Promise<void> {
    if (this.options.runStateSave) {
      await this.options.runStateSave({ ...input, env: this.buildCommandEnvironment(input.encryptionKey) })
      return
    }
    const command = resolveAgentBrowserCommand(this.buildCommandEnvironment(input.encryptionKey))
    if (!command)
      throw new BrowserIdentityError('AGENT_BROWSER_UNAVAILABLE', '未找到 agent-browser。请安装 agent-browser 后重试。')

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.executablePath, [
        ...command.executableArgs,
        '--cdp',
        input.endpoint,
        'state',
        'save',
        input.statePath,
      ], { env: this.buildCommandEnvironment(input.encryptionKey), stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new BrowserIdentityError('STATE_SAVE_TIMEOUT', '导出浏览器登录状态超时，请确认源浏览器已关闭后重试。'))
      }, IMPORT_TIMEOUT_MS)
      child.once('error', () => {
        clearTimeout(timer)
        reject(new BrowserIdentityError('STATE_SAVE_FAILED', 'agent-browser 无法连接源浏览器。', new Error(stderr)))
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        if (code === 0 && fs.existsSync(input.statePath)) {
          resolve()
          return
        }
        reject(new BrowserIdentityError('STATE_SAVE_FAILED', 'agent-browser 无法导出浏览器登录状态。请确认浏览器可以正常打开后重试。', new Error(stderr)))
      })
    })
  }

  private buildCommandEnvironment(encryptionKey: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.options.commandEnvironment,
      AGENT_BROWSER_ENCRYPTION_KEY: encryptionKey,
    }
  }

  private async persist(source: BrowserProfileSource, encryptionKey: string, statePath: string): Promise<void> {
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
    const nextGenerationStatePath = this.getGenerationStatePath(nextGeneration)
    const generationStateTemp = `${nextGenerationStatePath}.tmp-${randomUUID()}`
    await fs.promises.writeFile(identityTemp, JSON.stringify(metadata, null, 2), { mode: 0o600 })
    try {
      await fs.promises.copyFile(statePath, generationStateTemp)
      await fs.promises.chmod(generationStateTemp, 0o600)
      await fs.promises.rename(generationStateTemp, nextGenerationStatePath)
      await replaceFile(this.options.paths.identityPath, identityTemp)
    }
    catch (error) {
      await fs.promises.rm(generationStateTemp, { force: true })
      await fs.promises.rm(nextGenerationStatePath, { force: true })
      throw error
    }
    finally {
      await fs.promises.rm(identityTemp, { force: true })
    }
    this.current = metadata
    this.encryptionKey = encryptionKey
    this.generation = nextGeneration
    try {
      const currentStateTemp = `${this.options.paths.authStatePath}.tmp-${randomUUID()}`
      await fs.promises.copyFile(nextGenerationStatePath, currentStateTemp)
      await fs.promises.chmod(currentStateTemp, 0o600)
      await replaceFile(this.options.paths.authStatePath, currentStateTemp)
    }
    catch {
      this.options.logger?.warn('浏览器当前状态索引更新失败', {
        browser: source.browserName,
        profile: source.profileName,
        errorType: 'current-state-index',
      })
    }
    this.options.logger?.info('浏览器登录状态导入完成', {
      browser: source.browserName,
      profile: source.profileName,
      stateCount: 'unknown',
    })
  }

  private getGenerationStatePath(generation: number): string {
    return path.join(this.options.paths.root, `auth-state.g${generation}.enc`)
  }

  private async snapshotCurrentState(generation: number): Promise<void> {
    const generationPath = this.getGenerationStatePath(generation)
    await fs.promises.rm(generationPath, { force: true })
    await fs.promises.copyFile(this.options.paths.authStatePath, generationPath)
    await fs.promises.chmod(generationPath, 0o600)
  }

  private async removeGenerationStates(): Promise<void> {
    const entries = await fs.promises.readdir(this.options.paths.root).catch(() => [])
    await Promise.all(entries
      .filter(entry => /^auth-state\.g\d+\.enc$/.test(entry))
      .map(entry => fs.promises.rm(path.join(this.options.paths.root, entry), { force: true })))
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
  return { ...identity, available: Boolean(identity.executablePath) }
}

async function isSourceAvailable(identity: StoredBrowserIdentity): Promise<boolean> {
  const profile = await fs.promises.stat(path.join(identity.userDataDir, identity.profileDirectory)).catch(() => null)
  if (!profile?.isDirectory() || !identity.executablePath)
    return false
  try {
    await fs.promises.access(identity.executablePath, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
    return true
  }
  catch {
    return false
  }
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

async function readDevToolsEndpoint(userDataDir: string): Promise<string | null> {
  const content = await fs.promises.readFile(path.join(userDataDir, 'DevToolsActivePort'), 'utf8').catch(() => null)
  const port = content?.split(/\r?\n/)[0]?.trim()
  return port && /^\d+$/.test(port) ? `127.0.0.1:${port}` : null
}

async function waitForDevToolsEndpoint(userDataDir: string, notBefore?: number): Promise<string> {
  const deadline = Date.now() + IMPORT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const endpoint = await readDevToolsEndpoint(userDataDir)
    const endpointFile = await fs.promises.stat(path.join(userDataDir, 'DevToolsActivePort')).catch(() => null)
    if (endpoint && (!notBefore || (endpointFile?.mtimeMs ?? 0) >= notBefore))
      return endpoint
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new BrowserIdentityError('CDP_TIMEOUT', '源浏览器启动调试接口超时，请确认浏览器安装正常后重试。')
}

function hasBrowserLock(userDataDir: string): boolean {
  return ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].some(name => fs.existsSync(path.join(userDataDir, name)))
}

async function terminateProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return
  await new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    timer = setTimeout(() => {
      signalProcess(child, 'SIGKILL')
      resolve()
    }, 2_000)
    signalProcess(child, 'SIGTERM')
  })
}

function signalProcess(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    }
    catch {}
  }
  child.kill(signal)
}

interface AgentBrowserCommand {
  executablePath: string
  executableArgs: string[]
}

function resolveAgentBrowserCommand(env: NodeJS.ProcessEnv): AgentBrowserCommand | null {
  const pathValue = env.PATH ?? ''
  const direct = findExecutableOnPath('agent-browser', pathValue)
  if (direct)
    return { executablePath: direct, executableArgs: [] }
  const npx = findExecutableOnPath('npx', pathValue)
  return npx ? { executablePath: npx, executableArgs: ['agent-browser'] } : null
}

function findExecutableOnPath(name: string, pathValue: string): string | undefined {
  const names = process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name]
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const executableName of names) {
      const candidate = path.join(directory, executableName)
      try {
        fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
        if (fs.statSync(candidate).isFile())
          return candidate
      }
      catch {}
    }
  }
  return undefined
}
