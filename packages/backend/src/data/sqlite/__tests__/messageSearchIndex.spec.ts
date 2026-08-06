import type { Database } from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAppDataMigrations, runSqliteMigrations } from '../migrations'
import { extractSearchProjection, MessageSearchIndex } from '../messageSearchIndex'
import { SqliteConversationRepository } from '../repositories/sqliteConversationRepository'
import { SqliteMessageRepository } from '../repositories/sqliteMessageRepository'

const BetterSqlite = requireBetterSqlite()

describe('搜索投影抽取', () => {
  it('text 与 error block 进入 text，附件 block 忽略', () => {
    const projection = extractSearchProjection([
      { type: 'text', text: '第一段' },
      { type: 'error', error: '执行失败' },
      { type: 'image-block', source: { type: 'file_id', file_id: 'file-1' }, name: '图' },
      { type: 'document', source: { type: 'file_id', file_id: 'file-2' }, title: '文档' },
    ] as never)
    expect(projection.text).toBe('第一段\n执行失败')
    expect(projection.toolText).toBe('')
    expect(projection.toolFacts).toEqual([])
  })

  it('tool-call 进入 toolText 与结构化事实（toolName + args JSON）', () => {
    const projection = extractSearchProjection([
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'grep_files',
        serverName: 'ant-chat',
        args: { pattern: '*.ts', path: 'src' },
      },
    ] as never)
    expect(projection.text).toBe('')
    expect(projection.toolText).toContain('grep_files')
    expect(projection.toolText).toContain('"pattern":"*.ts"')
    expect(projection.toolFacts).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        kind: 'call',
        toolName: 'grep_files',
        serverName: 'ant-chat',
        argsText: JSON.stringify({ pattern: '*.ts', path: 'src' }),
      }),
    ])
  })

  it('tool-result 的 result JSON 序列化进 toolText 与事实', () => {
    const projection = extractSearchProjection([
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'read_file',
        result: { ok: true, lines: [1, 2] },
      },
    ] as never)
    expect(projection.toolText).toContain('read_file')
    expect(projection.toolText).toContain('"lines":[1,2]')
    expect(projection.toolFacts).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        kind: 'result',
        toolName: 'read_file',
        resultText: JSON.stringify({ ok: true, lines: [1, 2] }),
      }),
    ])
  })
})

describe('messageSearchIndex（migration v9 派生读模型）', () => {
  let sqlite: Database
  let attachmentsRoot: string
  let conversationRepository: SqliteConversationRepository
  let messageRepository: SqliteMessageRepository

  beforeEach(() => {
    sqlite = new BetterSqlite(':memory:')
    attachmentsRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-index-attachments-'))
    runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath: attachmentsRoot }))
    conversationRepository = new SqliteConversationRepository(sqlite)
    messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
  })

  afterEach(() => {
    sqlite.close()
    rmSync(attachmentsRoot, { force: true, recursive: true })
  })

  async function createConversation(workspacePath = '/workspace-a') {
    return await conversationRepository.create({
      title: '测试会话',
      workspacePath,
      createdAt: 1,
      updatedAt: 1,
      conversationInstructions: '',
      settings: { modelId: 'model-1', providerId: '' },
    })
  }

  function projectionRow(messageId: string) {
    return sqlite.prepare(`
      SELECT message_id, conversation_id, ordinal, role, status, text, tool_text
      FROM message_search_documents WHERE message_id = ?
    `).get(messageId)
  }

  function ftsRowCount() {
    return sqlite.prepare('SELECT COUNT(*) AS count FROM messages_fts_unicode').get() as { count: number }
  }

  it('migration v9 回填历史消息：ordinal、投影、tool facts、FTS 一致', async () => {
    // 模拟旧数据：绕过 repository 直接写表，再重建索引
    const conversation = await createConversation()
    sqlite.prepare(`
      INSERT INTO messages (id, conv_id, role, content, created_at, status, turn_id, ordinal)
      VALUES ('m-old-1', ?, 'user', ?, 100, 'success', NULL, 1)
    `).run(conversation.id, JSON.stringify([{ type: 'text', text: '旧的英文 evidence text' }]))
    sqlite.prepare(`
      INSERT INTO messages (id, conv_id, role, content, created_at, status, ordinal)
      VALUES ('m-old-2', ?, 'assistant', ?, 200, 'success', 2)
    `).run(conversation.id, JSON.stringify([{ type: 'tool-call', toolCallId: 'c1', toolName: 'glob_files', args: { pattern: '**/*.ts' } }]))
    sqlite.prepare(`
      INSERT INTO messages (id, conv_id, role, content, created_at, status, ordinal)
      VALUES ('m-old-3', ?, 'event', ?, 300, 'success', 3)
    `).run(conversation.id, JSON.stringify([{ type: 'text', text: '压缩摘要' }]))

    const index = new MessageSearchIndex(sqlite)
    index.rebuild()

    const first = projectionRow('m-old-1') as { ordinal: number, text: string }
    const second = projectionRow('m-old-2') as { ordinal: number, tool_text: string }
    expect(first.ordinal).toBe(1)
    expect(first.text).toBe('旧的英文 evidence text')
    expect(second.ordinal).toBe(2)
    expect(second.tool_text).toContain('glob_files')
    // event 消息不进入投影
    expect(projectionRow('m-old-3')).toBeUndefined()
    // FTS 与投影一致
    expect(ftsRowCount().count).toBe(2)
    const ftsHit = sqlite.prepare(`
      SELECT message_id FROM messages_fts_unicode WHERE messages_fts_unicode MATCH 'glob_files'
    `).get() as { message_id: string }
    expect(ftsHit.message_id).toBe('m-old-2')
    const facts = sqlite.prepare('SELECT kind, tool_name FROM message_tool_facts WHERE message_id = ?').all('m-old-2')
    expect(facts).toEqual([{ kind: 'call', tool_name: 'glob_files' }])
  })

  it('新增消息后投影与 FTS 同步更新（同事务）', async () => {
    const conversation = await createConversation()
    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: '新增的可搜索消息' }],
    })

    expect(projectionRow(message.id)).toEqual(expect.objectContaining({
      conversation_id: conversation.id,
      ordinal: 1,
      role: 'user',
      text: '新增的可搜索消息',
    }))
    expect(ftsRowCount().count).toBe(1)
  })

  it('更新消息内容后投影与 FTS 同步更新', async () => {
    const conversation = await createConversation()
    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: '旧内容' }],
    })
    await messageRepository.update({
      id: message.id,
      content: [{ type: 'text', text: '新内容 special-token-42' }],
    })

    expect((projectionRow(message.id) as { text: string }).text).toBe('新内容 special-token-42')
    const oldHit = sqlite.prepare(`SELECT message_id FROM messages_fts_unicode WHERE messages_fts_unicode MATCH '"旧内容"'`).get()
    expect(oldHit).toBeUndefined()
    const newHit = sqlite.prepare(`SELECT message_id FROM messages_fts_unicode WHERE messages_fts_unicode MATCH '"special-token-42"'`).get() as { message_id: string }
    expect(newHit.message_id).toBe(message.id)
  })

  it('删除消息后投影与 FTS 同步移除', async () => {
    const conversation = await createConversation()
    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: '将被删除' }],
    })
    await messageRepository.delete(message.id)

    expect(projectionRow(message.id)).toBeUndefined()
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM message_tool_facts').get()).toEqual({ count: 0 })
    expect(ftsRowCount().count).toBe(0)
  })

  it('同一会话内 ordinal 递增分配且不因并发写重复', async () => {
    const conversation = await createConversation()
    const first = await messageRepository.create({ convId: conversation.id, role: 'user', status: 'success', content: [{ type: 'text', text: 'a' }] })
    const second = await messageRepository.create({ convId: conversation.id, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'b' }], modelInfo: { provider: 'mock', model: 'mock' } } as never)
    const third = await messageRepository.create({ convId: conversation.id, role: 'user', status: 'success', content: [{ type: 'text', text: 'c' }] })

    const ordinals = [first, second, third].map(message =>
      (projectionRow(message.id) as { ordinal: number }).ordinal)
    expect(ordinals).toEqual([1, 2, 3])
  })

  it('role 更新为 event 时从投影与 FTS 移除', async () => {
    const conversation = await createConversation()
    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: '普通消息' }],
    })
    await messageRepository.update({ id: message.id, role: 'event', eventType: 'compaction' })

    expect(projectionRow(message.id)).toBeUndefined()
    expect(ftsRowCount().count).toBe(0)
  })
})

function requireBetterSqlite(): new (filename: string) => Database {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as new (filename: string) => Database
}
