import type { ImportSkillFromGithubOptions, ImportSkillOptions, SkillAppState, SkillFrontmatter, SkillIndex, SkillIndexFile, SkillManifest } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import yaml from 'js-yaml'

const INDEX_FILE = '.index.json'
const SKILL_NAME_PATTERN = /^[\w.-]+$/
const BUILTIN_SKILL_INSTALLER = 'skill-installer'
const BUILTIN_SKILL_MANAGER = 'ant-chat-manager'
const BUILTIN_SKILL_VISUALIZE = 'visualize'
const BUILTIN_SKILL_IMAGE_RECOGNITION = 'image-recognition'
/** base64 大小上限（约 24MB 的 zip 内容），防止超大上传拖垮本地服务。 */
const MAX_SKILL_ZIP_BASE64 = 32 * 1024 * 1024

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/

/**
 * 递归复制目录。
 * Electron 的 asar 支持不覆盖 fs.cp（底层 opendir 无法打开 app.asar 内的虚拟路径），
 * 但 readdir/readFile/copyFile 均可透明读写 asar；打包后 builtin-skills 位于 asar 内，
 * 因此逐文件复制而不是用 fs.cp。
 */
async function copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true })
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    if (entry.isDirectory())
      await copyDirectory(sourcePath, targetPath)
    else
      await fs.promises.copyFile(sourcePath, targetPath)
  }
}

/** 从已知位置定位 builtin-skills 源目录。 */
function resolveBuiltinSkillsSourceRoot(): string {
  const moduleDir = import.meta.dirname ?? __dirname
  const candidates = [
    path.join(moduleDir, 'builtin-skills'),
    path.resolve(moduleDir, '../../../builtin-skills'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, BUILTIN_SKILL_INSTALLER, 'SKILL.md'))) {
      return candidate
    }
  }
  throw new Error('内置 Skill 资源不存在，请先构建 backend 包')
}

export interface SkillManagementServiceOptions {
  skillsRoot: string
  /** 内置 Skill 源文件目录。默认从项目根目录 builtin-skills/ 解析。 */
  builtinSkillsSourceRoot?: string
}

export class SkillManagementService {
  private readonly skillsRoot: string
  private readonly builtinSkillsSourceRoot: string
  private initializationPromise: Promise<void> | undefined

  constructor(options: SkillManagementServiceOptions) {
    this.skillsRoot = options.skillsRoot
    this.builtinSkillsSourceRoot = options.builtinSkillsSourceRoot ?? resolveBuiltinSkillsSourceRoot()
  }

  getSkillsRoot(): string {
    return this.skillsRoot
  }

  ensureInitialized(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise
    }

    const initialization = this.initialize()
    this.initializationPromise = initialization
    void initialization.catch(() => {
      // 失败后允许下一次 RPC 重试初始化；成功则复用已完成的 Promise。
      if (this.initializationPromise === initialization) {
        this.initializationPromise = undefined
      }
    })
    return initialization
  }

  private async initialize(): Promise<void> {
    await fs.promises.mkdir(this.skillsRoot, { recursive: true })
    await this.migrateFromManifestJson()
    await this.ensureBuiltinSkillInstaller()
    await this.ensureBuiltinAntChatManager()
    await this.ensureBuiltinVisualize()
    await this.ensureBuiltinImageRecognition()
  }

  async listSkills(): Promise<SkillIndex> {
    await this.ensureInitialized()
    const appState = await this.readAppState()
    const entries = await fs.promises.readdir(this.skillsRoot, { withFileTypes: true })
    const skills: SkillManifest[] = []
    let dirty = false

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue
      }
      const skill = await this.loadSkill(entry.name, appState[entry.name])
      if (!skill) {
        continue
      }
      // 发现新 skill 目录但 .index.json 中无记录时，追加默认 appState
      if (!appState[entry.name]) {
        appState[entry.name] = createDefaultAppState('zip')
        dirty = true
      }
      skills.push(skill)
    }

    skills.sort((a, b) => a.name.localeCompare(b.name, 'en'))

    if (dirty) {
      await this.writeAppState(appState)
    }

    return { rootPath: this.skillsRoot, skills }
  }

  /** 统一导入入口：ZIP 走 base64 内容，GitHub 走仓库 URL。 */
  async importSkill(options: ImportSkillOptions): Promise<SkillManifest> {
    await this.ensureInitialized()
    if (options.source === 'zip') {
      if (options.zipBase64.length > MAX_SKILL_ZIP_BASE64) {
        throw new Error('ZIP 文件过大')
      }
      return this.importFromZipBuffer(Buffer.from(options.zipBase64, 'base64'), options.name)
    }
    return this.importFromGithub({ url: options.url, name: options.name })
  }

  private async importFromZipBuffer(zipBuffer: Buffer, name?: string): Promise<SkillManifest> {
    const tempDir = await this.createTempDir()
    try {
      await extractZip(zipBuffer, tempDir)
      return await this.importFromDirectory(findSkillRoot(tempDir), {
        source: 'zip',
        name,
      })
    }
    finally {
      await removePath(tempDir)
    }
  }

  async importFromGithub(options: ImportSkillFromGithubOptions): Promise<SkillManifest> {
    await this.ensureInitialized()
    const parsed = parseGithubUrl(options.url)
    const ref = parsed.ref ?? await fetchDefaultBranch(parsed.owner, parsed.repo)
    const commitSha = await fetchCommitSha(parsed.owner, parsed.repo, ref)
    // 用 sha 下载而非分支名：同一 URL 重复导入得到完全相同的版本，可复现。
    const archive = await downloadGithubArchive(parsed.owner, parsed.repo, commitSha)
    const tempDir = await this.createTempDir()
    try {
      await extractZip(archive, tempDir)
      const repoRoot = await getOnlyChildDirectory(tempDir)
      const sourceRoot = parsed.skillPath ? path.join(repoRoot, parsed.skillPath) : repoRoot
      const manifest = await this.importFromDirectory(findSkillRoot(sourceRoot), {
        source: 'github',
        sourceUrl: options.url,
        commitSha,
        name: options.name,
      })
      return manifest
    }
    finally {
      await removePath(tempDir)
    }
  }

  async setEnabled(name: string, enabled: boolean): Promise<SkillManifest> {
    await this.ensureInitialized()
    assertSkillName(name)
    const skillPath = path.join(this.skillsRoot, name)
    const frontmatter = await this.readFrontmatter(skillPath)
    const appState = await this.readAppState()
    const state = appState[name]
    if (!state) {
      throw new Error('AGENT_SKILL_NOT_FOUND')
    }
    if (state.builtin && !enabled) {
      throw new Error('BUILTIN_SKILL_CANNOT_BE_DISABLED')
    }
    state.enabled = enabled
    state.updatedAt = Date.now()
    appState[name] = state
    await this.writeAppState(appState)
    return { ...frontmatter, ...state }
  }

  async deleteSkill(name: string): Promise<void> {
    await this.ensureInitialized()
    assertSkillName(name)
    const skillPath = path.join(this.skillsRoot, name)
    const appState = await this.readAppState()
    const state = appState[name]
    if (!state) {
      throw new Error('AGENT_SKILL_NOT_FOUND')
    }
    if (state.builtin) {
      throw new Error('BUILTIN_SKILL_CANNOT_BE_DELETED')
    }
    await removePath(skillPath)
    delete appState[name]
    await this.writeAppState(appState)
  }

  async getEnabledSkills(): Promise<SkillManifest[]> {
    const { skills } = await this.listSkills()
    return skills.filter(skill => skill.enabled)
  }

  async readSkillMarkdown(name: string): Promise<string> {
    assertSkillName(name)
    const appState = await this.readAppState()
    const state = appState[name]
    if (!state || !state.enabled) {
      throw new Error('AGENT_SKILL_INVALID')
    }
    const skillFile = path.join(this.skillsRoot, name, 'SKILL.md')
    return fs.promises.readFile(skillFile, 'utf8')
  }

  async rebuildIndex(): Promise<SkillManifest[]> {
    await fs.promises.mkdir(this.skillsRoot, { recursive: true })
    const appState = await this.readAppState()
    const entries = await fs.promises.readdir(this.skillsRoot, { withFileTypes: true })
    const skills: SkillManifest[] = []
    const activeNames = new Set<string>()

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue
      }
      const skill = await this.loadSkill(entry.name, appState[entry.name])
      if (!skill) {
        continue
      }
      activeNames.add(entry.name)
      if (!appState[entry.name]) {
        appState[entry.name] = createDefaultAppState('zip')
      }
      skills.push(skill)
    }

    // 清理已删除目录的 appState 条目
    for (const name of Object.keys(appState)) {
      if (!activeNames.has(name)) {
        delete appState[name]
      }
    }

    skills.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    await this.writeAppState(appState)
    return skills
  }

  // ── 私有方法 ──────────────────────────────────────────────

  /**
   * 从 SKILL.md 的 YAML frontmatter 读取标准元数据。
   * frontmatter 缺失时用目录名兜底 name，description 留空。
   */
  private async readFrontmatter(skillPath: string): Promise<SkillFrontmatter> {
    const skillFile = path.join(skillPath, 'SKILL.md')
    const content = await fs.promises.readFile(skillFile, 'utf8')
    const match = content.match(FRONTMATTER_RE)
    if (match) {
      try {
        const parsed = yaml.load(match[1]) as Record<string, unknown>
        if (parsed && typeof parsed === 'object') {
          const name = typeof parsed.name === 'string' ? parsed.name : path.basename(skillPath)
          const description = typeof parsed.description === 'string' ? parsed.description : ''
          const frontmatter: SkillFrontmatter = { name, description }
          if (typeof parsed.version === 'string') {
            frontmatter.version = parsed.version
          }
          if (typeof parsed.license === 'string') {
            frontmatter.license = parsed.license
          }
          if (typeof parsed.compatibility === 'string') {
            frontmatter.compatibility = parsed.compatibility
          }
          if (parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata)) {
            frontmatter.metadata = parsed.metadata as Record<string, string>
          }
          if (typeof parsed['allowed-tools'] === 'string') {
            frontmatter.allowedTools = parsed['allowed-tools']
          }
          return frontmatter
        }
      }
      catch {}
    }
    // 无 frontmatter 时，尝试从 # heading 提取 name
    const headingName = this.extractHeadingName(content)
    return { name: headingName ?? path.basename(skillPath), description: '' }
  }

  /** 合并 frontmatter + appState 为完整的 SkillManifest */
  private async loadSkill(dirName: string, state?: SkillAppState): Promise<SkillManifest | null> {
    try {
      const skillPath = path.join(this.skillsRoot, dirName)
      const frontmatter = await this.readFrontmatter(skillPath)
      // 确保 name 与目录名一致
      if (frontmatter.name !== dirName) {
        frontmatter.name = dirName
      }
      const appState = state ?? createDefaultAppState('zip')
      return { ...frontmatter, ...appState }
    }
    catch {
      return null
    }
  }

  private async readAppState(): Promise<Record<string, SkillAppState>> {
    try {
      const content = await fs.promises.readFile(path.join(this.skillsRoot, INDEX_FILE), 'utf8')
      const data = JSON.parse(content) as SkillIndexFile
      if (data && typeof data === 'object' && data.version === 1 && data.skills) {
        return data.skills
      }
    }
    catch {}
    return {}
  }

  private async writeAppState(skills: Record<string, SkillAppState>): Promise<void> {
    const data: SkillIndexFile = { version: 1, skills }
    await fs.promises.writeFile(
      path.join(this.skillsRoot, INDEX_FILE),
      JSON.stringify(data, null, 2),
      'utf8',
    )
  }

  private async importFromDirectory(
    sourcePath: string,
    options: { source: SkillManifest['source'], sourceUrl?: string, commitSha?: string, name?: string },
  ): Promise<SkillManifest> {
    await validateSkillDirectory(sourcePath)
    const frontmatter = await this.readFrontmatter(sourcePath)
    const name = options.name ?? normalizeSkillName(frontmatter.name)
    assertSkillName(name)
    const targetPath = path.join(this.skillsRoot, name)
    if (fs.existsSync(targetPath)) {
      throw new Error(`SKILL_ALREADY_EXISTS: ${name}`)
    }

    const now = Date.now()
    const appState: SkillAppState = {
      source: options.source,
      sourceUrl: options.sourceUrl,
      commitSha: options.commitSha,
      enabled: true,
      builtin: false,
      installedAt: now,
      updatedAt: now,
    }

    await fs.promises.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true })

    // 确保导入的 SKILL.md frontmatter 中 name 与目录名一致
    await this.ensureFrontmatterName(targetPath, name)

    const allState = await this.readAppState()
    allState[name] = appState
    await this.writeAppState(allState)

    return { ...frontmatter, name, ...appState }
  }

  /**
   * 从 SKILL.md 正文中提取第一个 heading 作为兜底 name。
   * 仅在无 frontmatter 时使用。
   */
  private extractHeadingName(content: string): string | undefined {
    const match = content.match(/^# ([^\n]+)$/m)
    return match ? match[1].trim() : undefined
  }

  /** 如果 SKILL.md frontmatter 的 name 与目录名不一致，修正它 */
  private async ensureFrontmatterName(skillPath: string, dirName: string): Promise<void> {
    const skillFile = path.join(skillPath, 'SKILL.md')
    const content = await fs.promises.readFile(skillFile, 'utf8')
    const match = content.match(FRONTMATTER_RE)
    if (!match) {
      return
    }
    try {
      const parsed = yaml.load(match[1]) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string' && parsed.name !== dirName) {
        parsed.name = dirName
        const newFrontmatter = `---\n${yaml.dump(parsed, { lineWidth: -1 }).trim()}\n---`
        const newContent = content.replace(FRONTMATTER_RE, newFrontmatter)
        await fs.promises.writeFile(skillFile, newContent, 'utf8')
      }
    }
    catch {}
  }

  private async ensureBuiltinSkillInstaller(): Promise<void> {
    const skillPath = path.join(this.skillsRoot, BUILTIN_SKILL_INSTALLER)
    await fs.promises.mkdir(skillPath, { recursive: true })

    const sourceFile = path.join(this.builtinSkillsSourceRoot, BUILTIN_SKILL_INSTALLER, 'SKILL.md')
    let content = await fs.promises.readFile(sourceFile, 'utf8')
    // 替换运行时变量
    content = content.replace('{skillsRoot}', this.skillsRoot)

    const skillFile = path.join(skillPath, 'SKILL.md')
    await fs.promises.writeFile(skillFile, content, 'utf8')

    // 确保 appState 中有记录
    const appState = await this.readAppState()
    if (!appState[BUILTIN_SKILL_INSTALLER]) {
      const now = Date.now()
      appState[BUILTIN_SKILL_INSTALLER] = {
        enabled: true,
        builtin: true,
        source: 'builtin',
        installedAt: now,
        updatedAt: now,
      }
      await this.writeAppState(appState)
    }
  }

  /** 确保内置 ant-chat-manager Skill 存在 */
  private async ensureBuiltinAntChatManager(): Promise<void> {
    const skillPath = path.join(this.skillsRoot, BUILTIN_SKILL_MANAGER)
    await fs.promises.mkdir(skillPath, { recursive: true })

    const sourceFile = path.join(this.builtinSkillsSourceRoot, BUILTIN_SKILL_MANAGER, 'SKILL.md')
    const content = await fs.promises.readFile(sourceFile, 'utf8')

    const skillFile = path.join(skillPath, 'SKILL.md')
    await fs.promises.writeFile(skillFile, content, 'utf8')

    // 确保 appState 中有记录（默认启用）
    const appState = await this.readAppState()
    if (!appState[BUILTIN_SKILL_MANAGER]) {
      const now = Date.now()
      appState[BUILTIN_SKILL_MANAGER] = {
        enabled: true,
        builtin: true,
        source: 'builtin',
        installedAt: now,
        updatedAt: now,
      }
      await this.writeAppState(appState)
    }
  }

  /** 确保可视化 Skill 的协议文件存在，并保持用户启用状态不被初始化覆盖。 */
  private async ensureBuiltinVisualize(): Promise<void> {
    const skillPath = path.join(this.skillsRoot, BUILTIN_SKILL_VISUALIZE)
    const sourcePath = path.join(this.builtinSkillsSourceRoot, BUILTIN_SKILL_VISUALIZE)
    await copyDirectory(sourcePath, skillPath)

    const appState = await this.readAppState()
    if (!appState[BUILTIN_SKILL_VISUALIZE]) {
      const now = Date.now()
      appState[BUILTIN_SKILL_VISUALIZE] = {
        enabled: true,
        builtin: true,
        source: 'builtin',
        installedAt: now,
        updatedAt: now,
      }
      await this.writeAppState(appState)
    }
  }

  /** 确保内置图像识别 Skill 存在（纯文本主模型收到图片时由 agent 调用识别命令）。 */
  private async ensureBuiltinImageRecognition(): Promise<void> {
    const skillPath = path.join(this.skillsRoot, BUILTIN_SKILL_IMAGE_RECOGNITION)
    const sourcePath = path.join(this.builtinSkillsSourceRoot, BUILTIN_SKILL_IMAGE_RECOGNITION)
    await copyDirectory(sourcePath, skillPath)

    const appState = await this.readAppState()
    if (!appState[BUILTIN_SKILL_IMAGE_RECOGNITION]) {
      const now = Date.now()
      appState[BUILTIN_SKILL_IMAGE_RECOGNITION] = {
        enabled: true,
        builtin: true,
        source: 'builtin',
        installedAt: now,
        updatedAt: now,
      }
      await this.writeAppState(appState)
    }
  }

  /**
   * 迁移旧版 manifest.json 格式到新格式。
   * 检测条件：旧 .index.json 是数组，或 skill 目录下存在 manifest.json。
   */
  private async migrateFromManifestJson(): Promise<void> {
    const indexPath = path.join(this.skillsRoot, INDEX_FILE)
    let needsMigration = false

    // 检测旧格式 .index.json
    try {
      const content = await fs.promises.readFile(indexPath, 'utf8')
      const data = JSON.parse(content)
      if (Array.isArray(data) || (data && typeof data === 'object' && !data.version)) {
        needsMigration = true
      }
    }
    catch {
      // 文件不存在不算需要迁移
    }

    if (!needsMigration) {
      // 检查是否有遗留的 manifest.json
      try {
        const entries = await fs.promises.readdir(this.skillsRoot, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const manifestPath = path.join(this.skillsRoot, entry.name, 'manifest.json')
            if (fs.existsSync(manifestPath)) {
              needsMigration = true
              break
            }
          }
        }
      }
      catch {}
    }

    if (!needsMigration) {
      return
    }

    const appState: Record<string, SkillAppState> = {}

    try {
      const entries = await fs.promises.readdir(this.skillsRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue
        }
        const skillDir = path.join(this.skillsRoot, entry.name)
        const manifestPath = path.join(skillDir, 'manifest.json')

        // 尝试从旧 manifest.json 提取 appState
        if (fs.existsSync(manifestPath)) {
          try {
            const oldManifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'))
            appState[entry.name] = {
              enabled: oldManifest.enabled !== false,
              builtin: oldManifest.builtin === true,
              source: oldManifest.source === 'github' || oldManifest.source === 'builtin' ? oldManifest.source : 'zip',
              sourceUrl: typeof oldManifest.sourceUrl === 'string' ? oldManifest.sourceUrl : undefined,
              installedAt: typeof oldManifest.installedAt === 'number' ? oldManifest.installedAt : Date.now(),
              updatedAt: typeof oldManifest.updatedAt === 'number' ? oldManifest.updatedAt : Date.now(),
            }
          }
          catch {}
          // 删除旧 manifest.json
          await removePath(manifestPath)
        }
        else {
          appState[entry.name] = createDefaultAppState('zip')
        }
      }
    }
    catch {}

    await this.writeAppState(appState)
  }

  private createTempDir(): Promise<string> {
    return fs.promises.mkdtemp(path.join(tmpdir(), `ant-chat-skill-${randomUUID()}-`))
  }
}

// ── 工具函数 ─────────────────────────────────────────────────

function createDefaultAppState(source: 'zip' | 'github' | 'builtin'): SkillAppState {
  const now = Date.now()
  return { enabled: true, builtin: false, source, installedAt: now, updatedAt: now }
}

async function validateSkillDirectory(skillPath: string): Promise<void> {
  const stat = await fs.promises.stat(skillPath)
  if (!stat.isDirectory()) {
    throw new Error('AGENT_SKILL_INVALID')
  }
  const skillFile = path.join(skillPath, 'SKILL.md')
  if (!fs.existsSync(skillFile)) {
    throw new Error('AGENT_SKILL_INVALID: missing SKILL.md')
  }
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase().replace(/ /g, '-').replace(/[^\w.-]/g, '')
}

function assertSkillName(name: string): void {
  if (!name || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`AGENT_SKILL_INVALID: invalid skill name ${name}`)
  }
}

async function extractZip(zipBuffer: Buffer, targetDir: string): Promise<void> {
  const entries = unzipSync(new Uint8Array(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength))
  for (const [entryName, content] of Object.entries(entries)) {
    const safeName = normalizeZipEntryName(entryName)
    if (!safeName || safeName.endsWith('/')) {
      continue
    }
    const filePath = path.join(targetDir, safeName)
    const relative = path.relative(targetDir, filePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('AGENT_SKILL_INVALID: unsafe zip path')
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, Buffer.from(content))
  }
}

function normalizeZipEntryName(entryName: string): string {
  const normalized = path.posix.normalize(entryName.replace(/\\/g, '/'))
  if (normalized === '.' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error('AGENT_SKILL_INVALID: unsafe zip path')
  }
  return normalized
}

function findSkillRoot(inputPath: string, depth = 0): string {
  if (fs.existsSync(path.join(inputPath, 'SKILL.md'))) {
    return inputPath
  }
  if (depth >= 4) {
    throw new Error('AGENT_SKILL_INVALID: missing SKILL.md')
  }
  const entries = fs.readdirSync(inputPath, { withFileTypes: true }).filter(entry => entry.isDirectory())
  for (const entry of entries) {
    const candidate = path.join(inputPath, entry.name)
    if (fs.existsSync(path.join(candidate, 'SKILL.md'))) {
      return candidate
    }
    try {
      return findSkillRoot(candidate, depth + 1)
    }
    catch {}
  }
  throw new Error('AGENT_SKILL_INVALID: missing SKILL.md')
}

async function getOnlyChildDirectory(inputPath: string): Promise<string> {
  const entries = await fs.promises.readdir(inputPath, { withFileTypes: true })
  const directories = entries.filter(entry => entry.isDirectory())
  if (directories.length !== 1) {
    throw new Error('AGENT_SKILL_INVALID: invalid github archive')
  }
  return path.join(inputPath, directories[0].name)
}

function parseGithubUrl(url: string): { owner: string, repo: string, ref?: string, skillPath?: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    throw new Error('AGENT_SKILL_INVALID: invalid GitHub URL')
  }
  if (parsed.hostname !== 'github.com') {
    throw new Error('AGENT_SKILL_INVALID: only github.com URLs are supported')
  }
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length < 2) {
    throw new Error('AGENT_SKILL_INVALID: invalid GitHub URL')
  }
  const [owner, repo, tree, ref, ...rest] = parts
  if (tree && tree !== 'tree') {
    throw new Error('AGENT_SKILL_INVALID: GitHub URL must point to a repository or tree path')
  }
  return {
    owner,
    repo: repo.replace(/\.git$/, ''),
    ref,
    skillPath: rest.length > 0 ? rest.join('/') : undefined,
  }
}

async function fetchDefaultBranch(owner: string, repo: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`)
  if (!response.ok) {
    throw new Error(`AGENT_SKILL_INVALID: GitHub repository not found ${owner}/${repo}`)
  }
  const data = await response.json() as { default_branch?: string }
  return data.default_branch || 'main'
}

/** 把分支/tag 解析成 commit 哈希并记录，保证同一来源可复现。 */
async function fetchCommitSha(owner: string, repo: string, ref: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`)
  if (!response.ok) {
    throw new Error(`AGENT_SKILL_INVALID: failed to resolve commit ${owner}/${repo}@${ref}`)
  }
  const data = await response.json() as { sha?: string }
  if (!data.sha) {
    throw new Error(`AGENT_SKILL_INVALID: failed to resolve commit ${owner}/${repo}@${ref}`)
  }
  return data.sha
}

async function downloadGithubArchive(owner: string, repo: string, ref: string): Promise<Buffer> {
  const response = await fetch(`https://codeload.github.com/${owner}/${repo}/zip/${ref}`)
  if (!response.ok) {
    throw new Error(`AGENT_SKILL_INVALID: failed to download GitHub archive ${owner}/${repo}@${ref}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function removePath(inputPath: string): Promise<void> {
  await fs.promises.rm(inputPath, { recursive: true, force: true })
}
