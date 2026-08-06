import type { Database } from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAppDataMigrations, runSqliteMigrations } from '../../sqlite/migrations'
import { SqliteConversationRepository } from '../../sqlite/repositories/sqliteConversationRepository'
import { SqliteMessageRepository } from '../../sqlite/repositories/sqliteMessageRepository'
import { canonicalizeWorkspacePath } from '../../../workspace/workspaceIdentity'
import { deriveWorkspaceKey, SqliteMemoryCatalog } from '../sqliteMemoryCatalog'

const BetterSqlite = requireBetterSqlite()

describe('sqliteMemoryCatalog', () => {
  let sqlite: Database
  let attachmentsRoot: string
  let memoriesRoot: string
  let workspaceRoot: string
  let workspacePathA: string
  let workspacePathB: string
  let catalog: SqliteMemoryCatalog
  let conversationRepository: SqliteConversationRepository
  let messageRepository: SqliteMessageRepository
  let evidenceIds: string[]

  beforeEach(() => {
    sqlite = new BetterSqlite(':memory:')
    attachmentsRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-catalog-attachments-'))
    memoriesRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-catalog-memories-'))
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-catalog-workspaces-'))
    workspacePathA = path.join(workspaceRoot, 'ws-a')
    workspacePathB = path.join(workspaceRoot, 'ws-b')
    mkdirSync(workspacePathA, { recursive: true })
    mkdirSync(workspacePathB, { recursive: true })
    writeFileSync(path.join(workspacePathA, 'file.txt'), 'a')
    writeFileSync(path.join(workspacePathB, 'file.txt'), 'b')

    runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath: attachmentsRoot }))
    catalog = new SqliteMemoryCatalog(sqlite, memoriesRoot)
    conversationRepository = new SqliteConversationRepository(sqlite)
    messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })

    evidenceIds = []
  })

  afterEach(() => {
    sqlite.close()
    rmSync(attachmentsRoot, { force: true, recursive: true })
    rmSync(memoriesRoot, { force: true, recursive: true })
    rmSync(workspaceRoot, { force: true, recursive: true })
  })

  async function addEvidenceMessage(workspacePath: string, text: string): Promise<string> {
    const conversation = await conversationRepository.create({
      title: '证据会话',
      workspacePath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      conversationInstructions: '',
      settings: { modelId: 'model-1', providerId: '' },
    })
    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text }],
    })
    evidenceIds.push(message.id)
    return message.id
  }

  function proposal(workspacePath = workspacePathA, overrides: Partial<Parameters<SqliteMemoryCatalog['propose']>[0]> = {}) {
    return {
      workspacePath,
      title: '项目约定',
      summary: '部署前必须运行完整检查',
      body: '# 项目约定\n\n- 提交前运行 pnpm check',
      evidenceMessageIds: [...evidenceIds],
      ...overrides,
    }
  }

  // AtomicTextFileStore 写入时保证文件以换行结尾
  function expectedBodyFileContent(): string {
    const body = proposal().body
    return body.endsWith('\n') ? body : `${body}\n`
  }

  it('propose 创建 pending 记录且不写正文文件', async () => {
    await addEvidenceMessage(workspacePathA, '检查流程证据')
    const record = await catalog.propose(proposal())

    expect(record.status).toBe('pending')
    expect(record.workspaceKey).toBe(deriveWorkspaceKey(canonicalizeWorkspacePath(workspacePathA)))
    expect(record.bodyPath).toBe('')
    expect(record.approvedAt).toBeUndefined()
    expect(existsSync(path.join(memoriesRoot, record.workspaceKey, `${record.id}.md`))).toBe(false)

    const entries = catalog.listMemories({ status: 'pending' })
    expect(entries).toHaveLength(1)
    expect(entries[0].evidence.map(item => item.messageId)).toEqual(evidenceIds)
    expect(entries[0].evidence[0].text).toBe('检查流程证据')
  })

  it('证据消息必须真实存在，缺失时拒绝提议', async () => {
    await expect(catalog.propose(proposal(workspacePathA, { evidenceMessageIds: ['msg-missing'] })))
      .rejects
      .toThrow('证据消息不存在')
    await expect(catalog.propose(proposal(workspacePathA, { evidenceMessageIds: [] })))
      .rejects
      .toThrow('至少附带一条')
  })

  it('approve 写入 Markdown 文件并记录 sha256，变为 active', async () => {
    await addEvidenceMessage(workspacePathA, '证据文本')
    const pending = await catalog.propose(proposal())
    const record = await catalog.approve({ memoryId: pending.id })

    expect(record.status).toBe('active')
    expect(record.approvedAt).toBeDefined()
    expect(record.bodyPath).toBe(`${record.workspaceKey}/${record.id}.md`)
    expect(record.bodySha256).toBe(createHash('sha256').update(expectedBodyFileContent()).digest('hex'))

    const filePath = path.join(memoriesRoot, record.workspaceKey, `${record.id}.md`)
    expect(readFileSync(filePath, 'utf8')).toBe(expectedBodyFileContent())
    expect(catalog.getMemoryBody(record.id)).toBe(expectedBodyFileContent())
  })

  it('只有 pending 状态可以批准', async () => {
    await addEvidenceMessage(workspacePathA, '证据')
    const pending = await catalog.propose(proposal())
    await catalog.approve({ memoryId: pending.id })

    await expect(catalog.approve({ memoryId: pending.id })).rejects.toThrow('只有待批准')
  })

  it('archive 软删除：文件保留、不再召回、仍可追溯', async () => {
    await addEvidenceMessage(workspacePathA, '证据')
    const pending = await catalog.propose(proposal())
    const active = await catalog.approve({ memoryId: pending.id })
    const filePath = path.join(memoriesRoot, active.workspaceKey, `${active.id}.md`)

    const archived = await catalog.archive({ memoryId: pending.id })
    expect(archived.status).toBe('archived')
    expect(archived.archivedAt).toBeDefined()
    expect(existsSync(filePath)).toBe(true)
    expect(catalog.getMemoryBody(archived.id)).toBe(expectedBodyFileContent())

    const hits = await catalog.search({ query: '完整检查', workspacePath: workspacePathA })
    expect(hits).toHaveLength(0)
    expect(catalog.listMemories({ status: 'archived' })).toHaveLength(1)
  })

  it('search 只召回 active，且 workspace 相互隔离', async () => {
    await addEvidenceMessage(workspacePathA, 'A 的证据')
    await addEvidenceMessage(workspacePathB, 'B 的证据')
    const pendingA = await catalog.propose(proposal(workspacePathA, {
      title: 'A 的唯一结论',
      summary: 'alpha-token',
      evidenceMessageIds: [evidenceIds[0]],
    }))
    await catalog.approve({ memoryId: pendingA.id })
    const pendingB = await catalog.propose(proposal(workspacePathB, {
      title: 'B 的唯一结论',
      summary: 'alpha-token',
      evidenceMessageIds: [evidenceIds[1]],
    }))
    // B 保持 pending，不参与召回

    const hitsA = await catalog.search({ query: 'alpha-token', workspacePath: workspacePathA })
    expect(hitsA).toHaveLength(1)
    expect(hitsA[0].memory.title).toBe('A 的唯一结论')
    expect(hitsA[0].evidence.map(item => item.messageId)).toEqual([evidenceIds[0]])

    const hitsB = await catalog.search({ query: 'alpha-token', workspacePath: workspacePathB })
    expect(hitsB).toHaveLength(0)

    // 批准 B 后 B 才可被检索
    await catalog.approve({ memoryId: pendingB.id })
    const hitsBAfter = await catalog.search({ query: 'alpha-token', workspacePath: workspacePathB })
    expect(hitsBAfter).toHaveLength(1)
  })

  it('search 中文短语（≥3 字）走 trigram；短词走 LIKE', async () => {
    await addEvidenceMessage(workspacePathA, '证据')
    const pending = await catalog.propose(proposal(workspacePathA, { title: '缓存策略', summary: '缓存目录需要定期清理' }))
    await catalog.approve({ memoryId: pending.id })

    const longQuery = await catalog.search({ query: '缓存目录', workspacePath: workspacePathA })
    expect(longQuery).toHaveLength(1)

    const shortQuery = await catalog.search({ query: '缓存', workspacePath: workspacePathA })
    expect(shortQuery).toHaveLength(1)

    const missing = await catalog.search({ query: '不存在的词', workspacePath: workspacePathA })
    expect(missing).toHaveLength(0)
  })

  it('workspaceKey 由 canonical 路径稳定派生且文件系统安全', async () => {
    const canonicalA = canonicalizeWorkspacePath(workspacePathA)
    const canonicalB = canonicalizeWorkspacePath(workspacePathB)
    const key = deriveWorkspaceKey(canonicalA)
    expect(key).toMatch(/^[a-f0-9]{16}$/u)
    expect(key).toBe(deriveWorkspaceKey(canonicalA))
    expect(key).not.toBe(deriveWorkspaceKey(canonicalB))
  })
})

function requireBetterSqlite(): new (filename: string) => Database {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as new (filename: string) => Database
}
