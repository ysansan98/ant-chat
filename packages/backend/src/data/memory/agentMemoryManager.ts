import type { AgentMemoryEditInput, AgentMemoryEditResult, AgentMemoryFiles, AgentMemoryReader, AgentMemoryTarget, SoulUpdateMeta, SoulWriteInput, SoulWriteResult, UpdateAgentMemoryInput } from '@ant-chat/shared'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { AtomicTextFileStore } from './atomicTextFileStore'
import { DEFAULT_MEMORY, DEFAULT_SOUL, DEFAULT_USER_PROFILE } from './defaultAgentMemory'

const USER_FILE = 'USER.md'
const MEMORY_FILE = 'MEMORY.md'
const SOUL_FILE = 'SOUL.md'
const META_FILE = '.soul-update.json'
const BACKUP_DIR = '.soul-backups'
const LOCK_STALE_MS = 30_000
const LIMITS: Record<AgentMemoryTarget, number> = {
  user: 1375,
  memory: 2200,
}

export class AgentMemoryManager implements AgentMemoryReader {
  private readonly userStore: AtomicTextFileStore
  private readonly memoryStore: AtomicTextFileStore
  private readonly soulStore: AtomicTextFileStore
  private readonly metaPath: string
  private readonly backupDir: string
  private readonly lockPath: string

  constructor(private readonly memoryRootPath: string) {
    this.userStore = new AtomicTextFileStore(path.join(memoryRootPath, USER_FILE))
    this.memoryStore = new AtomicTextFileStore(path.join(memoryRootPath, MEMORY_FILE))
    this.soulStore = new AtomicTextFileStore(path.join(memoryRootPath, SOUL_FILE))
    this.metaPath = path.join(memoryRootPath, META_FILE)
    this.backupDir = path.join(memoryRootPath, BACKUP_DIR)
    this.lockPath = path.join(memoryRootPath, '.memory.lock')
    this.ensureInitialized()
  }

  async readMemoryFiles(): Promise<AgentMemoryFiles> {
    this.ensureInitialized()
    return {
      memoryRootPath: this.memoryRootPath,
      userMarkdown: this.userStore.read(),
      memoryMarkdown: this.memoryStore.read(),
      soulMarkdown: this.soulStore.read(),
      lastSoulUpdate: this.readMeta(),
    }
  }

  async readUserMemory(): Promise<string> {
    this.ensureInitialized()
    return this.userStore.read()
  }

  async readMemory(): Promise<string> {
    this.ensureInitialized()
    return this.memoryStore.read()
  }

  async readSoul(): Promise<string> {
    this.ensureInitialized()
    return this.soulStore.read()
  }

  async updateMemoryFiles(input: UpdateAgentMemoryInput): Promise<AgentMemoryFiles> {
    this.ensureInitialized()
    if (input.soulMarkdown !== undefined && !input.soulMarkdown.trim()) {
      throw new Error('SOUL.md content cannot be empty')
    }
    if (input.userMarkdown !== undefined) {
      this.userStore.write(input.userMarkdown)
    }
    if (input.memoryMarkdown !== undefined) {
      this.memoryStore.write(input.memoryMarkdown)
    }
    if (input.soulMarkdown !== undefined) {
      await this.updateSoul({
        content: input.soulMarkdown,
        summary: 'Manual SOUL.md update',
      })
    }
    return this.readMemoryFiles()
  }

  async editMemory(input: AgentMemoryEditInput): Promise<AgentMemoryEditResult> {
    this.ensureInitialized()
    return withFileLock(this.lockPath, () => {
      const store = input.target === 'user' ? this.userStore : this.memoryStore
      const limit = LIMITS[input.target]
      const current = store.read()
      assertMemoryFileFormat(current, store.filePath)
      const next = applyMemoryEdit(current, input)
      if (next.length > limit) {
        throw new Error(`MEMORY_LIMIT_EXCEEDED: ${input.target} ${next.length}/${limit} chars`)
      }
      store.write(next)
      return {
        entries: parseEntries(next),
        success: true,
        target: input.target,
        usage: `${Math.round((next.length / limit) * 100)}% - ${next.length}/${limit} chars`,
      }
    })
  }

  async updateSoul(input: SoulWriteInput): Promise<SoulWriteResult> {
    this.ensureInitialized()
    const content = input.content.trim()
    if (!content) {
      throw new Error('SOUL.md content cannot be empty')
    }

    const current = this.soulStore.read()
    if (normalizeText(current) === normalizeText(content)) {
      return { updated: false, meta: this.readMeta() }
    }

    mkdirSync(this.backupDir, { recursive: true })
    const updatedAt = Date.now()
    const backupPath = path.join(this.backupDir, `SOUL.${updatedAt}.md`)
    writeFileSync(backupPath, current, 'utf8')
    this.soulStore.write(content)

    const meta: SoulUpdateMeta = {
      updatedAt,
      summary: input.summary.trim() || 'SOUL.md updated',
      backupPath,
    }
    writeFileSync(this.metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

    return { updated: true, meta }
  }

  async rollbackSoul(): Promise<AgentMemoryFiles> {
    this.ensureInitialized()
    const meta = this.readMeta()
    if (!meta) {
      throw new Error('SOUL_ROLLBACK_UNAVAILABLE')
    }
    if (!existsSync(meta.backupPath)) {
      throw new Error('SOUL_ROLLBACK_BACKUP_MISSING')
    }

    const current = this.soulStore.read()
    mkdirSync(this.backupDir, { recursive: true })
    writeFileSync(path.join(this.backupDir, `SOUL.${Date.now()}.md`), current, 'utf8')
    this.soulStore.write(readFileSync(meta.backupPath, 'utf8'))
    renameSync(this.metaPath, `${this.metaPath}.${Date.now()}.rolled-back`)

    return this.readMemoryFiles()
  }

  private ensureInitialized(): void {
    mkdirSync(this.memoryRootPath, { recursive: true })
    if (!this.userStore.exists()) {
      this.userStore.write(DEFAULT_USER_PROFILE)
    }
    if (!this.memoryStore.exists()) {
      this.memoryStore.write(DEFAULT_MEMORY)
    }
    if (!this.soulStore.exists()) {
      this.soulStore.write(DEFAULT_SOUL)
    }
  }

  private readMeta(): SoulUpdateMeta | undefined {
    if (!existsSync(this.metaPath)) {
      return undefined
    }
    return JSON.parse(readFileSync(this.metaPath, 'utf8')) as SoulUpdateMeta
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\r\n/g, '\n')
}

function applyMemoryEdit(current: string, input: AgentMemoryEditInput): string {
  assertNoPromptInjection(input.content)
  assertNoPromptInjection(input.old_text)

  const entries = parseEntries(current)
  switch (input.action) {
    case 'add': {
      const content = requireText(input.content, 'content')
      if (entries.includes(content)) {
        throw new Error('Entry already exists (no duplicate added)')
      }
      return serializeEntries([...entries, content])
    }
    case 'replace': {
      const oldText = requireText(input.old_text, 'old_text')
      const content = requireText(input.content, 'content')
      const index = findEntryIndex(entries, oldText)
      entries[index] = content
      return serializeEntries(entries)
    }
    case 'remove': {
      const oldText = requireText(input.old_text, 'old_text')
      const index = findEntryIndex(entries, oldText)
      entries.splice(index, 1)
      return serializeEntries(entries)
    }
  }
}

function requireText(value: string | undefined, name: string): string {
  const text = value?.trim()
  if (!text) {
    throw new Error(`MEMORY_${name.toUpperCase()}_REQUIRED`)
  }
  return text
}

function assertNoPromptInjection(value: string | undefined): void {
  if (!value) {
    return
  }
  if (/<\/?(?:system|assistant|user|tool|developer|agent_behavior|user_preferences|agent_memory)>/iu.test(value)) {
    throw new Error('MEMORY_CONTENT_REJECTED')
  }
}

function assertMemoryFileFormat(value: string, filePath: string): void {
  const invalid = value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .find(line => !line.startsWith('§'))

  if (!invalid) {
    return
  }

  const backupPath = `${filePath}.bak.${Date.now()}`
  writeFileSync(backupPath, value, 'utf8')
  throw new Error(`MEMORY_FORMAT_DRIFT: backed up to ${backupPath}`)
}

function parseEntries(value: string): string[] {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith('§')) {
        return line.slice(1).trim()
      }
      return line
    })
}

function serializeEntries(entries: string[]): string {
  if (entries.length === 0) {
    return ''
  }
  return `${entries.map(entry => `§${entry}`).join('\n')}\n`
}

function findEntryIndex(entries: string[], oldText: string): number {
  // 模型可能传入带 § 前缀的文本，需要先去掉
  const normalizedOldText = oldText.startsWith('§') ? oldText.slice(1).trim() : oldText
  const matched = entries
    .map((entry, index) => ({ entry, index }))
    .filter(item => item.entry.includes(normalizedOldText))

  if (matched.length === 0) {
    throw new Error(`No entry matched '${oldText}'.`)
  }
  if (matched.length === 1) {
    return matched[0].index
  }

  const uniqueMatches = new Set(matched.map(item => item.entry))
  if (uniqueMatches.size === 1) {
    return matched[0].index
  }

  const preview = matched.map(item => item.entry).slice(0, 5).join(' | ')
  throw new Error(`Multiple entries matched. Be more specific. Matches: ${preview}`)
}

function withFileLock<T>(lockPath: string, operation: () => T): T {
  mkdirSync(path.dirname(lockPath), { recursive: true })
  const fd = acquireLock(lockPath)
  try {
    return operation()
  }
  finally {
    closeSync(fd)
    try {
      unlinkSync(lockPath)
    }
    catch {
      // The lock has already served its purpose; cleanup failure should not hide write results.
    }
  }
}

function acquireLock(lockPath: string): number {
  let fd: number | undefined
  try {
    fd = openSync(lockPath, 'wx')
    writeFileSync(lockPath, String(Date.now()), 'utf8')
    return fd
  }
  catch (error) {
    if (!isFileExistsError(error)) {
      throw error
    }
    const lockStat = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : ''
    const createdAt = Number(lockStat)
    if (Number.isFinite(createdAt) && Date.now() - createdAt > LOCK_STALE_MS) {
      unlinkSync(lockPath)
      fd = openSync(lockPath, 'wx')
      writeFileSync(lockPath, String(Date.now()), 'utf8')
      return fd
    }
    throw new Error('MEMORY_LOCKED')
  }
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST'
}
