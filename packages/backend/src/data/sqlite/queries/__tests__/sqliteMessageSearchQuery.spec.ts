import type { Database } from 'better-sqlite3'
import type { MessageContent } from '@ant-chat/shared'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAppDataMigrations, runSqliteMigrations } from '../../migrations'
import { SqliteConversationRepository } from '../../repositories/sqliteConversationRepository'
import { SqliteMessageRepository } from '../../repositories/sqliteMessageRepository'
import { SqliteMessageSearchQuery } from '../sqliteMessageSearchQuery'

const BetterSqlite = loadBetterSqlite()

describe('sqliteMessageSearchQuery', () => {
  let sqlite: Database
  let attachmentsRoot: string
  let conversationRepository: SqliteConversationRepository
  let messageRepository: SqliteMessageRepository
  let search: SqliteMessageSearchQuery

  beforeEach(() => {
    sqlite = new BetterSqlite(':memory:')
    attachmentsRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-user-search-'))
    runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath: attachmentsRoot }))
    conversationRepository = new SqliteConversationRepository(sqlite)
    messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    search = new SqliteMessageSearchQuery(sqlite)
  })

  afterEach(() => {
    sqlite.close()
    rmSync(attachmentsRoot, { force: true, recursive: true })
  })

  async function createConversation(title: string, createdAt: number) {
    return await conversationRepository.create({
      title,
      workspacePath: '/workspace',
      createdAt,
      updatedAt: createdAt,
      conversationInstructions: '',
      settings: { modelId: 'model-1', providerId: '' },
    })
  }

  async function addMessage(conversationId: string, content: MessageContent, createdAt: number) {
    return await messageRepository.create({
      convId: conversationId,
      role: 'user',
      status: 'success',
      content,
      createdAt,
    })
  }

  it('按会话与消息创建时间倒序分组，英文大小写不敏感', async () => {
    const older = await createConversation('Older', 1)
    const newer = await createConversation('Newer', 2)
    const olderFirst = await addMessage(older.id, [{ type: 'text', text: 'Needle in older conversation' }], 10)
    const olderSecond = await addMessage(older.id, [{ type: 'text', text: 'another needle here' }], 20)
    const newerMessage = await addMessage(newer.id, [{ type: 'text', text: 'needle in newer conversation' }], 5)

    const results = await search.searchMessagesByKeyword('needle')

    expect(results).toEqual([
      {
        id: newer.id,
        type: 'message',
        conversationId: newer.id,
        conversationTitle: 'Newer',
        createdAt: 2,
        messages: [{
          id: newerMessage.id,
          content: 'needle in newer conversation',
          createdAt: 5,
        }],
      },
      {
        id: older.id,
        type: 'message',
        conversationId: older.id,
        conversationTitle: 'Older',
        createdAt: 1,
        messages: [
          {
            id: olderSecond.id,
            content: 'another needle here',
            createdAt: 20,
          },
          {
            id: olderFirst.id,
            content: 'Needle in older conversation',
            createdAt: 10,
          },
        ],
      },
    ])
  })

  it('长中文词走 trigram，1–2 个中文字符走投影 LIKE', async () => {
    const conversation = await createConversation('中文会话', 1)
    const longWord = await addMessage(conversation.id, [{ type: 'text', text: '搜索投影与触发器设计' }], 1)
    const shortWord = await addMessage(conversation.id, [{ type: 'text', text: '缓存目录需要清理' }], 2)
    await addMessage(conversation.id, [{ type: 'text', text: '完全无关的内容' }], 3)

    const longResults = await search.searchMessagesByKeyword('搜索投影')
    const shortResults = await search.searchMessagesByKeyword('缓存')

    expect(longResults.flatMap(result => result.messages.map(message => message.id))).toEqual([longWord.id])
    expect(shortResults.flatMap(result => result.messages.map(message => message.id))).toEqual([shortWord.id])
  })

  it('特殊字符按字面处理：% _ 反斜杠不扩张通配符，引号不构成 FTS 表达式', async () => {
    const conversation = await createConversation('特殊字符', 1)
    const literal = await addMessage(conversation.id, [{ type: 'text', text: '缓存%_与反斜杠\\结束' }], 1)
    await addMessage(conversation.id, [{ type: 'text', text: '缓存XYZ普通内容' }], 2)
    await addMessage(conversation.id, [{ type: 'text', text: 'needle without secret' }], 3)

    const percentResults = await search.searchMessagesByKeyword('缓存%_')
    const backslashResults = await search.searchMessagesByKeyword('斜杠\\')
    const quoteResults = await search.searchMessagesByKeyword('needle" OR "missing')
    const wildcardResults = await search.searchMessagesByKeyword('%')

    expect(percentResults.flatMap(result => result.messages.map(message => message.id))).toEqual([literal.id])
    expect(backslashResults.flatMap(result => result.messages.map(message => message.id))).toEqual([literal.id])
    expect(quoteResults).toEqual([])
    // % 不再是 SQL LIKE 通配符，只按字面匹配包含 % 的消息
    expect(wildcardResults.flatMap(result => result.messages.map(message => message.id))).toEqual([literal.id])
  })

  it('英文与路径查询保持旧 LIKE 的子串语义', async () => {
    const conversation = await createConversation('子串', 1)
    const english = await addMessage(conversation.id, [{ type: 'text', text: 'a needle in the haystack' }], 1)
    const pathMessage = await addMessage(conversation.id, [{ type: 'text', text: '打开 /Users/name/project/file.ts 查看' }], 2)
    const shortWord = await addMessage(conversation.id, [{ type: 'text', text: 'abcde' }], 3)
    const idsOf = (results: Awaited<ReturnType<typeof search.searchMessagesByKeyword>>) =>
      results.flatMap(result => result.messages.map(message => message.id))

    expect(idsOf(await search.searchMessagesByKeyword('need'))).toEqual([english.id])
    expect(idsOf(await search.searchMessagesByKeyword('project/file'))).toEqual([pathMessage.id])
    expect(idsOf(await search.searchMessagesByKeyword('ab'))).toEqual([shortWord.id])
  })

  it('空查询返回空结果', async () => {
    const conversation = await createConversation('空查询', 1)
    await addMessage(conversation.id, [{ type: 'text', text: '任何内容' }], 1)

    await expect(search.searchMessagesByKeyword('')).resolves.toEqual([])
    await expect(search.searchMessagesByKeyword('   ')).resolves.toEqual([])
  })

  it('只匹配用户可读文本：text/error 命中，tool_text 不参与用户搜索', async () => {
    const conversation = await createConversation('范围', 1)
    const textHit = await addMessage(conversation.id, [{ type: 'text', text: 'needle in text' }], 1)
    const errorHit = await addMessage(conversation.id, [{ type: 'error', error: 'needle in error' }], 2)
    await addMessage(conversation.id, [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'grep_files', args: { pattern: 'needle' } }], 3)

    const results = await search.searchMessagesByKeyword('needle')

    expect(results.flatMap(result => result.messages.map(message => message.id))).toEqual([errorHit.id, textHit.id])
  })

  it('snippet 保留关键词上下文并截断长文本', async () => {
    const conversation = await createConversation('片段', 1)
    const text = `${'前'.repeat(60)}关键词${'后'.repeat(60)}`
    await addMessage(conversation.id, [{ type: 'text', text }], 1)

    const [result] = await search.searchMessagesByKeyword('关键词')

    expect(result.messages[0].content).toBe(`...${'前'.repeat(50)}关键词${'后'.repeat(50)}...`)
  })

  it('fts 标记关闭时降级到投影 LIKE', async () => {
    const conversation = await createConversation('降级', 1)
    const target = await addMessage(conversation.id, [{ type: 'text', text: '搜索投影需要回退到 LIKE' }], 1)
    sqlite.prepare('UPDATE message_search_meta SET value = \'0\' WHERE key IN (\'fts5\', \'fts_trigram\')').run()

    const degraded = new SqliteMessageSearchQuery(sqlite)
    const results = await degraded.searchMessagesByKeyword('搜索投影')

    expect(results.flatMap(result => result.messages.map(message => message.id))).toEqual([target.id])
  })

  it('fts 表缺失但标记为可用时仍降级到投影 LIKE', async () => {
    const conversation = await createConversation('缺表', 1)
    const target = await addMessage(conversation.id, [{ type: 'text', text: 'Needle survives missing FTS' }], 1)
    sqlite.exec('DROP TABLE messages_fts_unicode; DROP TABLE messages_fts_trigram;')

    const degraded = new SqliteMessageSearchQuery(sqlite)
    const results = await degraded.searchMessagesByKeyword('needle')

    expect(results.flatMap(result => result.messages.map(message => message.id))).toEqual([target.id])
  })

  it('查询计划不扫描 messages.content 的 JSON', async () => {
    const conversation = await createConversation('计划', 1)
    await addMessage(conversation.id, [{ type: 'text', text: 'needle for query plan' }], 1)

    const plan = sqlite.prepare(`
      EXPLAIN QUERY PLAN
      SELECT m.id
      FROM messages_fts_trigram f
      JOIN messages m ON m.id = f.message_id
      LEFT JOIN conversations c ON c.id = m.conv_id
      WHERE messages_fts_trigram MATCH ?
      ORDER BY c.created_at DESC, m.created_at DESC
    `).all('text : "needle"') as Array<{ detail: string }>

    const details = plan.map(row => row.detail).join('\n')
    expect(details).not.toContain('json_each')
    expect(details).not.toContain('SCAN messages')
  })
})

function loadBetterSqlite(): new (filename: string) => Database {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as new (filename: string) => Database
}
