import type { MemoryCatalogListEntry, MemoryCatalogPort, MemoryEvidenceView, MemoryHit, MemoryProposal, MemoryRecord, MemoryStatus } from '@ant-chat/shared'
import type { Statement } from 'better-sqlite3'
import type { AppDataDatabase } from '../sqlite/types'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { canonicalizeWorkspacePath } from '../../workspace/workspaceIdentity'
import { resolveSearchStrategy } from '../sqlite/sqliteMessageSearch'
import { AtomicTextFileStore } from './atomicTextFileStore'

/**
 * 长期记忆目录：人工批准的结论层。
 *
 * - pending 由 agent 提议；只有用户在 UI 批准后才 active 并写 Markdown 文件；
 * - 正文只允许存于 app-data/memories/<workspace-key>/ 下的 app-managed 相对路径；
 * - 归档是软删除（archived_at），文件保留，FTS 移除后不再召回；
 * - summary 进 FTS，正文不自动注入 prompt（V1 无自动召回）。
 */

const TITLE_MAX = 200
const SUMMARY_MAX = 1000
const BODY_MAX = 20_000
const MAX_EVIDENCE_PER_MEMORY = 20
const MAX_SEARCH_LIMIT = 20

interface MemoryRow {
  id: string
  workspace_key: string
  workspace_path: string
  title: string
  summary: string
  body_content: string
  body_path: string
  body_sha256: string
  status: string
  created_at: number
  approved_at: number | null
  archived_at: number | null
}

interface EvidenceRow {
  messageId: string
  conversationId: string
  conversationTitle: string
  ordinal: number
  role: string
  text: string
  createdAt: number
}

export class SqliteMemoryCatalog implements MemoryCatalogPort {
  private readonly trigramAvailable: boolean
  private readonly insertFtsStmt?: Statement
  private readonly deleteFtsStmt?: Statement

  constructor(
    private readonly db: AppDataDatabase,
    private readonly memoriesRoot: string,
  ) {
    this.trigramAvailable = this.readTrigramCapability()
    if (this.trigramAvailable) {
      this.insertFtsStmt = db.prepare(`
        INSERT INTO memories_fts_trigram (memory_id, title, summary) VALUES (?, ?, ?)
      `)
      this.deleteFtsStmt = db.prepare('DELETE FROM memories_fts_trigram WHERE memory_id = ?')
    }
  }

  async propose(input: MemoryProposal): Promise<MemoryRecord> {
    const title = input.title?.trim()
    const summary = input.summary?.trim()
    const body = input.body?.trim()
    if (!title) {
      throw new Error('记忆标题不能为空')
    }
    if (!summary) {
      throw new Error('记忆摘要不能为空')
    }
    if (!body) {
      throw new Error('记忆正文不能为空')
    }
    if (title.length > TITLE_MAX || summary.length > SUMMARY_MAX || body.length > BODY_MAX) {
      throw new Error(`记忆内容超出限制（标题 ${TITLE_MAX} / 摘要 ${SUMMARY_MAX} / 正文 ${BODY_MAX} 字符）`)
    }
    const workspacePath = canonicalizeWorkspacePath(input.workspacePath)
    const workspaceKey = deriveWorkspaceKey(workspacePath)

    const evidenceIds = [...new Set(input.evidenceMessageIds ?? [])]
    if (evidenceIds.length === 0) {
      throw new Error('记忆必须至少附带一条消息证据')
    }
    this.assertEvidenceExists(evidenceIds)

    const id = `mem-${nanoid()}`
    const now = Date.now()
    const insert = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO memories (
          id, workspace_key, workspace_path, title, summary, body_content,
          body_path, body_sha256, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, '', '', 'pending', ?)
      `).run(id, workspaceKey, workspacePath, title, summary, body, now)
      const statement = this.db.prepare(`
        INSERT INTO memory_evidence (memory_id, message_id) VALUES (?, ?)
      `)
      for (const messageId of evidenceIds) {
        statement.run(id, messageId)
      }
      this.insertFtsStmt?.run(id, title, summary)
    })
    insert()

    return this.requireRecord(id)
  }

  async approve(input: { memoryId: string }): Promise<MemoryRecord> {
    const row = this.db.prepare<unknown[], MemoryRow>('SELECT * FROM memories WHERE id = ?').get(input.memoryId)
    if (!row) {
      throw new Error('记忆未找到')
    }
    if (row.status !== 'pending') {
      throw new Error('只有待批准的记忆可以批准')
    }

    const filePath = this.resolveMemoryBodyPath(row)
    const store = new AtomicTextFileStore(filePath)
    // 文件写入带尾部换行归一化；sha256 覆盖实际文件字节，保证文件可校验
    const fileContent = row.body_content.endsWith('\n') ? row.body_content : `${row.body_content}\n`
    store.write(fileContent)
    const sha256 = createHash('sha256').update(fileContent).digest('hex')
    const relativePath = path.join(row.workspace_key, `${row.id}.md`)

    this.db.prepare(`
      UPDATE memories
      SET status = 'active', approved_at = ?, body_path = ?, body_sha256 = ?
      WHERE id = ?
    `).run(Date.now(), relativePath, sha256, row.id)

    return this.requireRecord(row.id)
  }

  async archive(input: { memoryId: string }): Promise<MemoryRecord> {
    const row = this.db.prepare<unknown[], MemoryRow>('SELECT * FROM memories WHERE id = ?').get(input.memoryId)
    if (!row) {
      throw new Error('记忆未找到')
    }
    if (row.status === 'archived') {
      return this.mapRecord(row)
    }
    // 归档是软删除：文件不删，仅不再召回
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE memories
        SET status = 'archived', archived_at = ?
        WHERE id = ?
      `).run(Date.now(), row.id)
      this.deleteFtsStmt?.run(row.id)
    })()
    return this.requireRecord(row.id)
  }

  async search(input: { query: string, workspacePath: string, limit?: number }): Promise<MemoryHit[]> {
    const query = input.query?.trim()
    if (!query) {
      throw new Error('搜索关键词不能为空')
    }
    const limit = clampInt(input.limit ?? 5, 1, MAX_SEARCH_LIMIT)
    const workspaceKey = deriveWorkspaceKey(canonicalizeWorkspacePath(input.workspacePath))

    const rows = this.queryActiveMemories(query, workspaceKey, limit)
    return rows.map(row => ({
      memory: this.mapRecord(row),
      evidence: this.listEvidence(row.id, 3),
    }))
  }

  // ---- UI 能力 ----

  listMemories(input: { status?: MemoryStatus } = {}): MemoryCatalogListEntry[] {
    const rows = input.status
      ? this.db.prepare<unknown[], MemoryRow>(`
          SELECT * FROM memories WHERE status = ? ORDER BY created_at DESC
        `).all(input.status)
      : this.db.prepare<unknown[], MemoryRow>(`
          SELECT * FROM memories ORDER BY created_at DESC
        `).all()
    return rows.map(row => ({
      memory: this.mapRecord(row),
      evidence: this.listEvidence(row.id, MAX_EVIDENCE_PER_MEMORY),
    }))
  }

  getMemoryBody(memoryId: string): string {
    const row = this.db.prepare<unknown[], MemoryRow>('SELECT * FROM memories WHERE id = ?').get(memoryId)
    if (!row) {
      throw new Error('记忆未找到')
    }
    if (row.status === 'pending') {
      return row.body_content
    }
    // 正文文件是批准时写入的制品；文件缺失时回退到库内正文，不阻断 UI
    try {
      return readFileSync(this.resolveMemoryBodyPath(row), 'utf8')
    }
    catch {
      return row.body_content
    }
  }

  // ---- 内部 ----

  private queryActiveMemories(query: string, workspaceKey: string, limit: number): MemoryRow[] {
    const strategy = resolveSearchStrategy(true, this.trigramAvailable, query)
    if (strategy === 'trigram') {
      // FTS5 的 MATCH 必须使用表名而非别名（join 场景下别名解析为列引用）
      return this.db.prepare<unknown[], MemoryRow>(`
        SELECT m.*
        FROM memories_fts_trigram f
        JOIN memories m ON m.id = f.memory_id
        WHERE memories_fts_trigram MATCH ? AND m.status = 'active' AND m.workspace_key = ?
        ORDER BY COALESCE(m.approved_at, m.created_at) DESC
        LIMIT ?
      `).all(ftsPhrase(query), workspaceKey, limit)
    }

    const pattern = `%${escapeLikePattern(query)}%`
    return this.db.prepare<unknown[], MemoryRow>(`
      SELECT *
      FROM memories
      WHERE status = 'active' AND workspace_key = ?
        AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')
      ORDER BY COALESCE(approved_at, created_at) DESC
      LIMIT ?
    `).all(workspaceKey, pattern, pattern, limit)
  }

  private listEvidence(memoryId: string, limit: number): MemoryEvidenceView[] {
    return this.db.prepare<unknown[], EvidenceRow>(`
      SELECT
        e.message_id AS messageId,
        IFNULL(d.conversation_id, m.conv_id) AS conversationId,
        IFNULL(c.title, '') AS conversationTitle,
        IFNULL(d.ordinal, 0) AS ordinal,
        IFNULL(d.role, m.role) AS role,
        IFNULL(d.text, '') AS text,
        m.created_at AS createdAt
      FROM memory_evidence e
      JOIN messages m ON m.id = e.message_id
      LEFT JOIN message_search_documents d ON d.message_id = e.message_id
      LEFT JOIN conversations c ON c.id = IFNULL(d.conversation_id, m.conv_id)
      WHERE e.memory_id = ?
      ORDER BY d.ordinal ASC
      LIMIT ?
    `).all(memoryId, limit)
  }

  private assertEvidenceExists(messageIds: string[]): void {
    const placeholders = messageIds.map(() => '?').join(', ')
    const rows = this.db.prepare<unknown[], { id: string }>(`
      SELECT id FROM messages WHERE id IN (${placeholders})
    `).all(...messageIds)
    if (rows.length !== messageIds.length) {
      throw new Error('证据消息不存在或已删除')
    }
  }

  private resolveMemoryBodyPath(row: MemoryRow): string {
    // workspace_key 由本模块生成（sha256 hex 前 16 位），此处防御性校验，
    // 防止外部篡改数据库导致路径逃逸出 memories root
    if (!/^[a-f0-9]{16}$/u.test(row.workspace_key)) {
      throw new Error('记忆目录标识无效')
    }
    const filePath = path.resolve(this.memoriesRoot, row.workspace_key, `${row.id}.md`)
    const root = path.resolve(this.memoriesRoot)
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      throw new Error('记忆正文路径越界')
    }
    return filePath
  }

  private requireRecord(memoryId: string): MemoryRecord {
    const row = this.db.prepare<unknown[], MemoryRow>('SELECT * FROM memories WHERE id = ?').get(memoryId)
    if (!row) {
      throw new Error('记忆未找到')
    }
    return this.mapRecord(row)
  }

  private mapRecord(row: MemoryRow): MemoryRecord {
    return {
      id: row.id,
      workspaceKey: row.workspace_key,
      workspacePath: row.workspace_path,
      title: row.title,
      summary: row.summary,
      bodyPath: row.body_path,
      bodySha256: row.body_sha256,
      status: row.status as MemoryStatus,
      createdAt: row.created_at,
      approvedAt: row.approved_at ?? undefined,
      archivedAt: row.archived_at ?? undefined,
    }
  }

  private readTrigramCapability(): boolean {
    try {
      const row = this.db.prepare<unknown[], { value: string }>(`
        SELECT value FROM message_search_meta WHERE key = 'fts_trigram'
      `).get()
      return row?.value === '1'
    }
    catch {
      return false
    }
  }
}

/** 由 canonical workspace 身份派生文件系统安全的工作区键。 */
export function deriveWorkspaceKey(canonicalWorkspacePath: string): string {
  return createHash('sha256').update(canonicalWorkspacePath).digest('hex').slice(0, 16)
}

function ftsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
