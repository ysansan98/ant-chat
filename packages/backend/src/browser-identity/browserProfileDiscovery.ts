import type { BrowserProfileKind, BrowserProfileSourceView } from '@ant-chat/shared'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export interface BrowserProfileSource extends BrowserProfileSourceView {
  kind: BrowserProfileKind
  userDataDir: string
  profileDirectory: string
  executablePath: string
}

export interface BrowserProfileDiscoveryOptions {
  platform?: NodeJS.Platform
  homeDir?: string
  env?: NodeJS.ProcessEnv
  extraDirectories?: string[]
}

interface BrowserCandidate {
  kind: BrowserProfileKind
  browserName: string
  userDataDir: string
  executableCandidates: string[]
}

const PROFILE_DIRECTORY_NAMES = /^(?:Default|Profile \d+)$/

export async function discoverBrowserProfiles(options: BrowserProfileDiscoveryOptions = {}): Promise<BrowserProfileSource[]> {
  const candidates = getCandidates(options)
  const sources = new Map<string, BrowserProfileSource>()
  for (const candidate of candidates) {
    const profiles = await readProfiles(candidate)
    for (const profile of profiles) {
      sources.set(profile.sourceId, profile)
    }
  }
  return [...sources.values()].sort((a, b) => a.browserName.localeCompare(b.browserName) || a.profileName.localeCompare(b.profileName))
}

/** 将桌面原生目录选择器返回的目录转换为可导入来源。 */
export async function inspectBrowserDirectory(directory: string, options: BrowserProfileDiscoveryOptions = {}): Promise<BrowserProfileSource> {
  const resolved = path.resolve(directory)
  const stat = await fs.promises.stat(resolved).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new Error('选择的目录不存在或不是目录')
  }

  const profileDirectory = PROFILE_DIRECTORY_NAMES.test(path.basename(resolved))
    ? path.basename(resolved)
    : await findDefaultProfile(resolved)
  const userDataDir = PROFILE_DIRECTORY_NAMES.test(path.basename(resolved)) ? path.dirname(resolved) : resolved
  if (!profileDirectory) {
    throw new Error('选择的目录不是 Chromium 浏览器 Profile')
  }

  const kind = inferBrowserKind(userDataDir)
  const browser = getBrowserDefinition(
    kind,
    options.platform ?? process.platform,
    options.homeDir ?? os.homedir(),
    options.env ?? process.env,
  )
  const executablePath = findExistingPath(browser.executableCandidates, options.env ?? process.env)
  const profileName = await readProfileName(userDataDir, profileDirectory)
  return createSource({
    kind,
    browserName: browser.browserName,
    userDataDir,
    profileDirectory,
    executablePath,
    profileName,
  })
}

async function readProfiles(candidate: BrowserCandidate): Promise<BrowserProfileSource[]> {
  const stat = await fs.promises.stat(candidate.userDataDir).catch(() => null)
  if (!stat?.isDirectory())
    return []

  const profileNames = new Set<string>()
  const localState = await readJson(path.join(candidate.userDataDir, 'Local State'))
  const cache = isRecord(localState?.profile) && isRecord(localState.profile.info_cache)
    ? localState.profile.info_cache
    : undefined
  if (cache) {
    for (const name of Object.keys(cache))
      profileNames.add(name)
  }
  const entries = await fs.promises.readdir(candidate.userDataDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory() && PROFILE_DIRECTORY_NAMES.test(entry.name))
      profileNames.add(entry.name)
  }

  const executablePath = findExistingPath(candidate.executableCandidates)
  const sources: BrowserProfileSource[] = []
  for (const profileDirectory of profileNames) {
    const profilePath = path.join(candidate.userDataDir, profileDirectory)
    const profileStat = await fs.promises.stat(profilePath).catch(() => null)
    if (!profileStat?.isDirectory())
      continue
    const profileName = getCachedProfileName(cache, profileDirectory) ?? await readProfileName(candidate.userDataDir, profileDirectory)
    sources.push(createSource({
      kind: candidate.kind,
      browserName: candidate.browserName,
      userDataDir: candidate.userDataDir,
      profileDirectory,
      executablePath,
      profileName,
    }))
  }
  return sources
}

function getCandidates(options: BrowserProfileDiscoveryOptions): BrowserCandidate[] {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? os.homedir()
  const api = platform === 'win32' ? path.win32 : path.posix
  const appData = env.APPDATA ?? api.join(homeDir, 'AppData', 'Roaming')
  const localAppData = env.LOCALAPPDATA ?? api.join(homeDir, 'AppData', 'Local')
  const candidates: BrowserCandidate[] = []

  if (platform === 'darwin') {
    candidates.push(
      createCandidate('chrome', 'Chrome', api.join(homeDir, 'Library/Application Support/Google/Chrome'), ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']),
      createCandidate('edge', 'Edge', api.join(homeDir, 'Library/Application Support/Microsoft Edge'), ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']),
      createCandidate('chromium', 'Chromium', api.join(homeDir, 'Library/Application Support/Chromium'), ['/Applications/Chromium.app/Contents/MacOS/Chromium']),
      createCandidate('brave', 'Brave', api.join(homeDir, 'Library/Application Support/BraveSoftware/Brave-Browser'), ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']),
    )
  }
  else if (platform === 'win32') {
    candidates.push(
      createCandidate('chrome', 'Chrome', api.join(localAppData, 'Google/Chrome/User Data'), [api.join(localAppData, 'Google/Chrome/Application/chrome.exe')]),
      createCandidate('edge', 'Edge', api.join(localAppData, 'Microsoft/Edge/User Data'), [api.join(localAppData, 'Microsoft/Edge/Application/msedge.exe')]),
      createCandidate('chromium', 'Chromium', api.join(localAppData, 'Chromium/User Data'), [api.join(localAppData, 'Chromium/Application/chrome.exe')]),
      createCandidate('brave', 'Brave', api.join(localAppData, 'BraveSoftware/Brave-Browser/User Data'), [api.join(localAppData, 'BraveSoftware/Brave-Browser/Application/brave.exe')]),
    )
  }
  else {
    candidates.push(
      createCandidate('chrome', 'Chrome', api.join(homeDir, '.config/google-chrome'), ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']),
      createCandidate('edge', 'Edge', api.join(homeDir, '.config/microsoft-edge'), ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']),
      createCandidate('chromium', 'Chromium', api.join(homeDir, '.config/chromium'), ['/usr/bin/chromium', '/usr/bin/chromium-browser']),
      createCandidate('brave', 'Brave', api.join(homeDir, '.config/BraveSoftware/Brave-Browser'), ['/usr/bin/brave-browser', '/usr/bin/brave-browser-stable']),
    )
  }

  for (const directory of options.extraDirectories ?? []) {
    candidates.push(createCandidate(inferBrowserKind(directory), 'Chromium', directory, []))
  }
  // Windows 的 APPDATA 仍被部分 Chromium 发行版使用，保留这两个已知位置。
  if (platform === 'win32') {
    candidates.push(createCandidate('chrome', 'Chrome', api.join(appData, 'Google/Chrome/User Data'), []))
  }
  return candidates
}

function createCandidate(kind: BrowserProfileKind, browserName: string, userDataDir: string, executableCandidates: string[]): BrowserCandidate {
  return { kind, browserName, userDataDir, executableCandidates }
}

function getBrowserDefinition(kind: BrowserProfileKind, platform: NodeJS.Platform = process.platform, homeDir: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): { browserName: string, executableCandidates: string[] } {
  return {
    browserName: kind === 'brave' ? 'Brave' : kind === 'edge' ? 'Edge' : kind === 'chrome' ? 'Chrome' : 'Chromium',
    executableCandidates: (() => {
      const api = platform === 'win32' ? path.win32 : path.posix
      const localAppData = env.LOCALAPPDATA ?? api.join(homeDir, 'AppData', 'Local')
      if (platform === 'darwin') {
        return kind === 'chrome'
          ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'google-chrome']
          : kind === 'edge'
            ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'microsoft-edge']
            : kind === 'brave'
              ? ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', 'brave-browser']
              : ['/Applications/Chromium.app/Contents/MacOS/Chromium', 'chromium']
      }
      if (platform === 'win32') {
        return kind === 'chrome'
          ? [api.join(localAppData, 'Google/Chrome/Application/chrome.exe'), 'chrome.exe']
          : kind === 'edge'
            ? [api.join(localAppData, 'Microsoft/Edge/Application/msedge.exe'), 'msedge.exe']
            : kind === 'brave'
              ? [api.join(localAppData, 'BraveSoftware/Brave-Browser/Application/brave.exe'), 'brave.exe']
              : [api.join(localAppData, 'Chromium/Application/chrome.exe'), 'chromium.exe']
      }
      return kind === 'chrome'
        ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', 'google-chrome']
        : kind === 'edge'
          ? ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', 'microsoft-edge']
          : kind === 'brave'
            ? ['/usr/bin/brave-browser', '/usr/bin/brave-browser-stable', 'brave-browser']
            : ['/usr/bin/chromium', '/usr/bin/chromium-browser', 'chromium']
    })(),
  }
}

function createSource(input: Omit<BrowserProfileSource, 'sourceId' | 'available'>): BrowserProfileSource {
  const sourceId = createHash('sha256')
    .update(`${input.kind}\0${path.resolve(input.userDataDir)}\0${input.profileDirectory}`)
    .digest('hex')
    .slice(0, 24)
  return {
    ...input,
    sourceId,
    available: Boolean(input.executablePath),
  }
}

async function readProfileName(userDataDir: string, profileDirectory: string): Promise<string> {
  const preferences = await readJson(path.join(userDataDir, profileDirectory, 'Preferences'))
  const profile = isRecord(preferences?.profile) ? preferences.profile : undefined
  return typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim() : profileDirectory
}

function getCachedProfileName(cache: Record<string, unknown> | undefined, profileDirectory: string): string | undefined {
  const value = cache?.[profileDirectory]
  if (!isRecord(value))
    return undefined
  for (const key of ['name', 'user_name', 'gaia_name']) {
    if (typeof value[key] === 'string' && value[key].trim())
      return value[key].trim()
  }
  return undefined
}

async function findDefaultProfile(userDataDir: string): Promise<string | undefined> {
  const entries = await fs.promises.readdir(userDataDir, { withFileTypes: true }).catch(() => [])
  return entries.find(entry => entry.isDirectory() && PROFILE_DIRECTORY_NAMES.test(entry.name))?.name
}

async function readJson(filePath: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as Record<string, any>
  }
  catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function findExistingPath(candidates: string[], env: NodeJS.ProcessEnv = process.env): string {
  for (const candidate of candidates) {
    if (isExecutableFile(candidate))
      return candidate
    const pathCandidate = findExecutableOnPath(candidate, env.PATH ?? '')
    if (pathCandidate)
      return pathCandidate
  }
  return ''
}

function findExecutableOnPath(name: string, pathValue: string): string | undefined {
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name)
    if (isExecutableFile(candidate))
      return candidate
  }
  return undefined
}

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
    return fs.statSync(candidate).isFile()
  }
  catch {
    return false
  }
}

function inferBrowserKind(directory: string): BrowserProfileKind {
  const value = directory.toLowerCase()
  if (value.includes('edge'))
    return 'edge'
  if (value.includes('brave'))
    return 'brave'
  if (value.includes('google') || value.includes('chrome'))
    return 'chrome'
  return 'chromium'
}
