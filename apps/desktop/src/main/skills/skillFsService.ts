import type { ImportSkillFromGithubOptions, SkillIndex, SkillManifest } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getAppDataRoot } from '@main/utils/appPaths'
import { unzipSync } from 'fflate'

const SKILL_ROOT = path.join(getAppDataRoot(), 'skills')
const INDEX_FILE = '.index.json'
const SKILL_NAME_PATTERN = /^[\w.-]+$/
const BUILTIN_SKILL_INSTALLER = 'skill-installer'

const BUILTIN_SKILL_INSTALLER_MD = `# Skill Installer

Install skills from GitHub into the Ant Chat skills directory.

Use this skill when the user asks to install, list, or manage skills from GitHub. Prefer the built-in install_skill_from_github tool for installation. Installed skills are stored under ~/.ant-chat/skills.
`

export class SkillFsService {
  getSkillsRoot(): string {
    return SKILL_ROOT
  }

  async ensureInitialized(): Promise<void> {
    await fs.promises.mkdir(SKILL_ROOT, { recursive: true })
    await this.ensureBuiltinSkillInstaller()
    await this.rebuildIndex()
  }

  async listSkills(): Promise<SkillIndex> {
    await this.ensureInitialized()
    const skills = await this.readIndexOrRebuild()
    return { rootPath: SKILL_ROOT, skills }
  }

  async importFromZip(zipPath: string): Promise<SkillManifest> {
    await this.ensureInitialized()
    const tempDir = await this.createTempDir()
    try {
      const zipBuffer = await fs.promises.readFile(zipPath)
      await extractZip(zipBuffer, tempDir)
      return await this.importFromDirectory(findSkillRoot(tempDir), {
        source: 'zip',
        sourceUrl: zipPath,
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
    const archive = await downloadGithubArchive(parsed.owner, parsed.repo, ref)
    const tempDir = await this.createTempDir()
    try {
      await extractZip(archive, tempDir)
      const repoRoot = await getOnlyChildDirectory(tempDir)
      const sourceRoot = parsed.skillPath ? path.join(repoRoot, parsed.skillPath) : repoRoot
      const manifest = await this.importFromDirectory(findSkillRoot(sourceRoot), {
        source: 'github',
        sourceUrl: options.url,
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
    const skillPath = path.join(SKILL_ROOT, name)
    const manifest = await this.readManifest(skillPath)
    if (manifest.builtin && !enabled) {
      throw new Error('BUILTIN_SKILL_CANNOT_BE_DISABLED')
    }
    const updated = { ...manifest, enabled, updatedAt: Date.now() }
    await this.writeManifest(skillPath, updated)
    await this.rebuildIndex()
    return updated
  }

  async deleteSkill(name: string): Promise<void> {
    await this.ensureInitialized()
    assertSkillName(name)
    const skillPath = path.join(SKILL_ROOT, name)
    const manifest = await this.readManifest(skillPath)
    if (manifest.builtin) {
      throw new Error('BUILTIN_SKILL_CANNOT_BE_DELETED')
    }
    await removePath(skillPath)
    await this.rebuildIndex()
  }

  async getEnabledSkills(): Promise<SkillManifest[]> {
    const { skills } = await this.listSkills()
    return skills.filter(skill => skill.enabled)
  }

  async readSkillMarkdown(name: string): Promise<string> {
    assertSkillName(name)
    const skillPath = path.join(SKILL_ROOT, name)
    const manifest = await this.readManifest(skillPath)
    if (!manifest.enabled) {
      throw new Error('AGENT_SKILL_INVALID')
    }
    const skillFile = path.join(skillPath, 'SKILL.md')
    return fs.promises.readFile(skillFile, 'utf8')
  }

  async rebuildIndex(): Promise<SkillManifest[]> {
    await fs.promises.mkdir(SKILL_ROOT, { recursive: true })
    const entries = await fs.promises.readdir(SKILL_ROOT, { withFileTypes: true })
    const skills: SkillManifest[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue
      }
      try {
        const manifest = await this.readManifest(path.join(SKILL_ROOT, entry.name))
        if (manifest.name !== entry.name) {
          manifest.name = entry.name
          await this.writeManifest(path.join(SKILL_ROOT, entry.name), manifest)
        }
        skills.push(manifest)
      }
      catch {}
    }
    skills.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    await fs.promises.writeFile(path.join(SKILL_ROOT, INDEX_FILE), JSON.stringify(skills, null, 2), 'utf8')
    return skills
  }

  private async importFromDirectory(
    sourcePath: string,
    options: { source: SkillManifest['source'], sourceUrl?: string, name?: string },
  ): Promise<SkillManifest> {
    await validateSkillDirectory(sourcePath)
    const metadata = await readSkillMetadata(sourcePath)
    const name = options.name ?? metadata.name
    assertSkillName(name)
    const targetPath = path.join(SKILL_ROOT, name)
    if (fs.existsSync(targetPath)) {
      throw new Error(`SKILL_ALREADY_EXISTS: ${name}`)
    }

    const now = Date.now()
    const manifest: SkillManifest = {
      name,
      version: metadata.version,
      description: metadata.description,
      source: options.source,
      sourceUrl: options.sourceUrl,
      enabled: true,
      installedAt: now,
      updatedAt: now,
    }

    await fs.promises.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true })
    await this.writeManifest(targetPath, manifest)
    await this.rebuildIndex()
    return manifest
  }

  private async readIndexOrRebuild(): Promise<SkillManifest[]> {
    try {
      const content = await fs.promises.readFile(path.join(SKILL_ROOT, INDEX_FILE), 'utf8')
      const data = JSON.parse(content)
      if (Array.isArray(data)) {
        return data.map(normalizeManifest)
      }
    }
    catch {}
    return this.rebuildIndex()
  }

  private async readManifest(skillPath: string): Promise<SkillManifest> {
    const manifestPath = path.join(skillPath, 'manifest.json')
    const content = await fs.promises.readFile(manifestPath, 'utf8')
    return normalizeManifest(JSON.parse(content))
  }

  private writeManifest(skillPath: string, manifest: SkillManifest): Promise<void> {
    return fs.promises.writeFile(path.join(skillPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  }

  private async ensureBuiltinSkillInstaller(): Promise<void> {
    const skillPath = path.join(SKILL_ROOT, BUILTIN_SKILL_INSTALLER)
    const now = Date.now()
    await fs.promises.mkdir(skillPath, { recursive: true })
    const skillFile = path.join(skillPath, 'SKILL.md')
    if (!fs.existsSync(skillFile)) {
      await fs.promises.writeFile(skillFile, BUILTIN_SKILL_INSTALLER_MD, 'utf8')
    }
    const manifestPath = path.join(skillPath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      await this.writeManifest(skillPath, {
        name: BUILTIN_SKILL_INSTALLER,
        description: 'Install skills from GitHub into Ant Chat.',
        source: 'builtin',
        enabled: true,
        builtin: true,
        installedAt: now,
        updatedAt: now,
      })
    }
  }

  private createTempDir(): Promise<string> {
    return fs.promises.mkdtemp(path.join(tmpdir(), `ant-chat-skill-${randomUUID()}-`))
  }
}

export const skillFsService = new SkillFsService()

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

async function readSkillMetadata(skillPath: string): Promise<Pick<SkillManifest, 'name' | 'version' | 'description'>> {
  const manifestPath = path.join(skillPath, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    const parsed = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'))
    return {
      name: normalizeSkillName(String(parsed.name || path.basename(skillPath))),
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
    }
  }

  const markdown = await fs.promises.readFile(path.join(skillPath, 'SKILL.md'), 'utf8')

  const frontmatter = parseFrontmatter(markdown)
  const title = frontmatter?.name || markdown
    .split('\n')
    .find(line => line.startsWith('# '))
    ?.slice(2)
    .trim()
  const description = frontmatter?.description
    || extractBodyDescription(markdown)
  return {
    name: normalizeSkillName(title || path.basename(skillPath)),
    version: undefined,
    description,
  }
}

function parseFrontmatter(markdown: string): { name?: string, description?: string } | null {
  const match = markdown.match(/^---\n([\s\S]*?\n)---/)
  if (!match)
    return null
  const nameMatch = match[1].match(/^name:\s+(\S.*)$/m)
  const descMatch = match[1].match(/^description:\s+(\S.*)$/m)
  return {
    name: nameMatch ? nameMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
  }
}

function extractBodyDescription(markdown: string): string | undefined {
  const bodyStart = markdown.startsWith('---\n')
    ? markdown.indexOf('\n---\n')
    : -1
  const body = bodyStart > 0 ? markdown.slice(bodyStart + 5) : markdown
  return body
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'))
}

function normalizeManifest(value: unknown): SkillManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('AGENT_SKILL_INVALID')
  }
  const data = value as Record<string, unknown>
  const name = String(data.name || '')
  assertSkillName(name)
  return {
    name,
    version: typeof data.version === 'string' ? data.version : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    source: data.source === 'github' || data.source === 'builtin' ? data.source : 'zip',
    sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : undefined,
    enabled: data.builtin === true ? true : data.enabled !== false,
    builtin: data.builtin === true,
    installedAt: typeof data.installedAt === 'number' ? data.installedAt : Date.now(),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
  }
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase().replaceAll(' ', '-').replace(/[^\w.-]/g, '')
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
