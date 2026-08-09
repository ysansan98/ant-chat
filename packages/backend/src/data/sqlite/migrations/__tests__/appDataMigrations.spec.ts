import type { Database } from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAppDataMigrations } from '../appDataMigrations'
import { runSqliteMigrations } from '../runMigrations'

const BetterSqlite = requireBetterSqlite()

describe('app-data SQLite 迁移', () => {
  let sqlite: Database
  let attachmentsRootPath: string

  beforeEach(() => {
    sqlite = new BetterSqlite(':memory:')
    attachmentsRootPath = mkdtempSync(path.join(tmpdir(), 'ant-chat-migrations-'))
  })

  afterEach(() => {
    sqlite.close()
    rmSync(attachmentsRootPath, { recursive: true, force: true })
  })

  it('新数据库初始化到当前版本并记录迁移历史', () => {
    runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath }))

    const tables = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all() as Array<{ name: string }>
    const history = sqlite.prepare('SELECT version, name FROM app_data_migrations').all()
    expect(tables.map(table => table.name)).toEqual(expect.arrayContaining([
      'app_data_migrations',
      'attachments',
      'automation_runs',
      'automations',
      'conversations',
      'messages',
      'channel_accounts',
      'channel_pairings',
      'channel_sessions',
      'channel_message_receipts',
      'message_search_documents',
      'message_tool_facts',
      'message_search_meta',
      'memories',
      'memory_evidence',
    ]))
    expect(history).toEqual([
      { version: 1, name: '初始化 app-data schema' },
      { version: 2, name: '增加会话归档状态' },
      { version: 3, name: '重命名自动化 selected 字段为 allowed' },
      { version: 4, name: '分离会话指令并迁移输出 token 字段' },
      { version: 5, name: '关联自动化运行与 Agent Turn' },
      { version: 6, name: '增加消息频道数据模型' },
      { version: 7, name: '约束频道出站消息与平台消息一一对应' },
      { version: 8, name: '增加消息频道权限模式' },
      { version: 9, name: '消息搜索投影、FTS 与长期记忆目录' },
      { version: 10, name: '记录微信扫码登录 owner 身份' },
      { version: 11, name: '自动化 run 状态收窄并增加已读标记' },
    ])
  })

  it('为旧数据库增加频道来源、入口和幂等表', () => {
    runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath }))

    const conversationColumns = sqlite.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
    const messageColumns = sqlite.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
    expect(conversationColumns.map(column => column.name)).toEqual(expect.arrayContaining(['source_type', 'source_channel_account_id', 'source_external_chat_id']))
    expect(messageColumns.map(column => column.name)).toEqual(expect.arrayContaining(['origin_type', 'origin_channel_account_id', 'origin_external_chat_id']))
    expect((sqlite.prepare('PRAGMA table_info(channel_accounts)').all() as Array<{ name: string }>).map(column => column.name)).toContain('permission_mode')
    expect((sqlite.prepare('PRAGMA table_info(channel_accounts)').all() as Array<{ name: string }>).map(column => column.name)).toContain('owner_user_id')
    expect(sqlite.prepare('SELECT sql FROM sqlite_master WHERE name = \'channel_message_receipts\'').get()).toEqual(expect.objectContaining({ sql: expect.stringContaining('UNIQUE (channel_account_id, external_message_id, direction, part_index)') }))
  })

  it('无版本记录的旧数据库通过首个版本迁移到当前表结构', () => {
    sqlite.exec(`
      CREATE TABLE conversations (
        id text PRIMARY KEY NOT NULL,
        workspace_path text,
        title text NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        settings text NOT NULL
      );
      CREATE TABLE messages (
        id text PRIMARY KEY NOT NULL,
        conv_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role text NOT NULL,
        content text NOT NULL,
        created_at integer NOT NULL,
        status text NOT NULL,
        reasoning_content text,
        model_info text DEFAULT NULL,
        usage text DEFAULT NULL,
        turn_id text DEFAULT NULL,
        event_type text DEFAULT NULL,
        images text NOT NULL DEFAULT '[]',
        attachments text NOT NULL DEFAULT '[]'
      );
    `)

    runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath }))

    const messageColumns = sqlite.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
    const messageColumnNames = messageColumns.map(column => column.name)
    expect(messageColumnNames).toEqual(expect.arrayContaining([
      'duration_ms',
      'compacted_through_message_id',
    ]))
    expect(messageColumnNames).not.toEqual(expect.arrayContaining(['images', 'attachments']))
    const conversationColumns = sqlite.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
    expect(conversationColumns.map(column => column.name)).toContain('archived')
    expect(sqlite.prepare('SELECT version FROM app_data_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }, { version: 11 }])
  })

  // ===== 测试：version 8 → 9 迁移 =====

  describe('version 8→9 迁移', () => {
    it('为历史消息回填 ordinal、投影与 FTS，并记录 FTS 能力', () => {
      // 模拟 v8 数据库：先跑全量迁移，再插入旧格式消息，重建后再验证 v9 幂等
      runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath }))
      sqlite.prepare(`
        INSERT INTO conversations (id, workspace_path, title, created_at, updated_at, archived, settings)
        VALUES ('conv-legacy', '/ws', '旧会话', 1, 1, 0, '{}')
      `).run()
      sqlite.prepare(`
        INSERT INTO messages (id, conv_id, role, content, created_at, status)
        VALUES ('m-l1', 'conv-legacy', 'user', ?, 100, 'success')
      `).run(JSON.stringify([{ type: 'text', text: 'legacy english evidence searchable text' }]))
      sqlite.prepare(`
        INSERT INTO messages (id, conv_id, role, content, created_at, status)
        VALUES ('m-l2', 'conv-legacy', 'user', ?, 200, 'success')
      `).run(JSON.stringify([{ type: 'text', text: '中文长词检索目标' }]))
      sqlite.prepare(`
        INSERT INTO messages (id, conv_id, role, content, created_at, status)
        VALUES ('m-l3', 'conv-legacy', 'assistant', ?, 300, 'success')
      `).run(JSON.stringify([{ type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', args: { path: '/etc/hosts' } }]))

      // 模拟 v8 → v9 升级：清空迁移历史到 v8，重建
      sqlite.prepare('DELETE FROM app_data_migrations WHERE version > 8').run()
      sqlite.prepare('DELETE FROM message_search_documents').run()
      sqlite.prepare('DELETE FROM message_tool_facts').run()
      runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath }))

      // ordinal 按 created_at 回填
      const ordinals = sqlite.prepare(`
        SELECT id, ordinal FROM messages WHERE conv_id = 'conv-legacy' ORDER BY ordinal
      `).all() as Array<{ id: string, ordinal: number }>
      expect(ordinals.map(row => row.id)).toEqual(['m-l1', 'm-l2', 'm-l3'])

      // 投影与 FTS 回填；event 不进入
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM message_search_documents').get()).toEqual({ count: 3 })
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM message_tool_facts').get()).toEqual({ count: 1 })
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM messages_fts_unicode').get()).toEqual({ count: 3 })
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM messages_fts_trigram').get()).toEqual({ count: 3 })

      // 英文多 token 短语在 unicode61 FTS 可命中
      const englishHit = sqlite.prepare(`
        SELECT message_id FROM messages_fts_unicode WHERE messages_fts_unicode MATCH '"evidence searchable"'
      `).get() as { message_id: string }
      expect(englishHit.message_id).toBe('m-l1')

      // 中文长词在 trigram FTS 可命中
      const cjkHit = sqlite.prepare(`
        SELECT message_id FROM messages_fts_trigram WHERE messages_fts_trigram MATCH '"中文长词检索目标"'
      `).get() as { message_id: string }
      expect(cjkHit.message_id).toBe('m-l2')

      // 能力位显式记录
      expect(sqlite.prepare('SELECT value FROM message_search_meta WHERE key = \'fts5\'').get()).toEqual({ value: '1' })
      expect(sqlite.prepare('SELECT value FROM message_search_meta WHERE key = \'fts_trigram\'').get()).toEqual({ value: '1' })

      // 唯一索引保证 (conv_id, ordinal) 唯一
      const dup = sqlite.prepare(`
        SELECT COUNT(*) AS count FROM (
          SELECT conv_id, ordinal FROM messages GROUP BY conv_id, ordinal HAVING COUNT(*) > 1
        )
      `).get() as { count: number }
      expect(dup.count).toBe(0)
    })

    it('再次运行迁移不重复回填', () => {
      runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath }))
      sqlite.prepare(`
        INSERT INTO conversations (id, workspace_path, title, created_at, updated_at, archived, settings)
        VALUES ('conv-idem', '/ws', '幂等', 1, 1, 0, '{}')
      `).run()
      sqlite.prepare(`
        INSERT INTO messages (id, conv_id, role, content, created_at, status)
        VALUES ('m-i1', 'conv-idem', 'user', ?, 1, 'success')
      `).run(JSON.stringify([{ type: 'text', text: '幂等检查文本' }]))

      const before = sqlite.prepare('SELECT COUNT(*) AS count FROM message_search_documents').get() as { count: number }
      runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath }))
      const after = sqlite.prepare('SELECT COUNT(*) AS count FROM message_search_documents').get() as { count: number }
      expect(after.count).toBe(before.count)
      const applied = sqlite.prepare('SELECT COUNT(*) AS count FROM app_data_migrations WHERE version = 9').get() as { count: number }
      expect(applied.count).toBe(1)
    })
  })

  // ===== 测试：version 3 → 4 迁移 =====

  describe('version 3→4 迁移', () => {
    /**
     * 模拟旧版本数据库升级：创建旧表、记录 v1-v3 已执行、插入旧格式数据、再应用 v4 迁移。
     */
    function runV4MigrationWithOldData(settings: Record<string, unknown>) {
      // 清理 beforeEach 创建的现有表结构，模拟旧数据库
      sqlite.exec(`
        DROP TABLE IF EXISTS app_data_migrations;
        DROP TABLE IF EXISTS conversations;
      `)
      // 1. 创建旧表结构（匹配 v1 但无 conversation_instructions）
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id text PRIMARY KEY NOT NULL,
          workspace_path text,
          title text NOT NULL,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          archived integer NOT NULL DEFAULT 0,
          settings text NOT NULL
        );
      `)
      // 2. 创建 migration 表并模拟 v1-v3 已执行
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS app_data_migrations (
          version integer PRIMARY KEY NOT NULL,
          name text NOT NULL,
          applied_at integer NOT NULL
        );
      `)
      sqlite.prepare('INSERT INTO app_data_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(1, '初始化 app-data schema', Date.now())
      sqlite.prepare('INSERT INTO app_data_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(2, '增加会话归档状态', Date.now())
      sqlite.prepare('INSERT INTO app_data_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(3, '重命名自动化 selected 字段为 allowed', Date.now())
      // 3. 插入旧格式数据（使用 systemPrompt / maxTokens）
      sqlite.prepare(`
        INSERT INTO conversations (id, workspace_path, title, created_at, updated_at, archived, settings)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('v4-c', '/workspace', 'test', 1, 1, JSON.stringify(settings))
      // 4. 仅应用 v4 迁移
      runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath }))
    }

    it('迁移后新增 conversation_instructions 列', () => {
      runV4MigrationWithOldData({
        modelId: 'm1',
        providerId: 'p1',
        temperature: 0.7,
        maxOutputTokens: 4096,
        systemPrompt: '请用中文回答',
      })

      const col = sqlite.prepare(
        'SELECT name FROM pragma_table_info(\'conversations\') WHERE name = \'conversation_instructions\'',
      ).get() as { name: string } | undefined
      expect(col).toBeDefined()
      if (col) {
        const row = sqlite.prepare('SELECT conversation_instructions FROM conversations WHERE id = ?').get('v4-c') as { conversation_instructions: string }
        expect(row.conversation_instructions).toBe('请用中文回答')
      }
    })

    it('迁移后 settings JSON 删除旧字段', () => {
      runV4MigrationWithOldData({
        modelId: 'm1',
        providerId: 'p1',
        temperature: 0.7,
        maxTokens: 4096,
        systemPrompt: '旧版指令',
      })

      const row = sqlite.prepare('SELECT settings, conversation_instructions FROM conversations WHERE id = ?').get('v4-c') as { settings: string, conversation_instructions: string }
      const parsed = JSON.parse(row.settings)
      expect(parsed).not.toHaveProperty('systemPrompt')
      expect(parsed).not.toHaveProperty('maxTokens')
      expect(parsed.maxOutputTokens).toBe(4096)
      expect(row.conversation_instructions).toBe('旧版指令')
    })

    it('迁移后 reasoningEffort 和 compaction 保留', () => {
      runV4MigrationWithOldData({
        modelId: 'm1',
        providerId: 'p1',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: 'test',
        reasoningEffort: 'high',
        compaction: { enabled: true, thresholdPercent: 80, keepRecentTokens: 30000 },
      })

      const row = sqlite.prepare('SELECT settings FROM conversations WHERE id = ?').get('v4-c') as { settings: string }
      const parsed = JSON.parse(row.settings)
      expect(parsed.reasoningEffort).toBe('high')
      expect(parsed.compaction).toEqual({ enabled: true, thresholdPercent: 80, keepRecentTokens: 30000 })
    })

    it('未设置 compaction 时迁移后不新增', () => {
      runV4MigrationWithOldData({
        modelId: 'm1',
        providerId: 'p1',
        temperature: 0.7,
        maxTokens: 2048,
      })

      const row = sqlite.prepare('SELECT settings FROM conversations WHERE id = ?').get('v4-c') as { settings: string }
      const parsed = JSON.parse(row.settings)
      expect(parsed).not.toHaveProperty('compaction')
    })

    it('空 prompt 迁移为空字符串', () => {
      runV4MigrationWithOldData({
        modelId: 'm1',
        providerId: 'p1',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: '',
      })

      const row = sqlite.prepare('SELECT conversation_instructions FROM conversations WHERE id = ?').get('v4-c') as { conversation_instructions: string }
      expect(row.conversation_instructions).toBe('')
    })

    it('无 systemPrompt 时 conversation_instructions 默认空字符串', () => {
      runV4MigrationWithOldData({
        modelId: 'm1',
        providerId: 'p1',
        temperature: 0.7,
        maxTokens: 2048,
      })

      const row = sqlite.prepare('SELECT conversation_instructions FROM conversations WHERE id = ?').get('v4-c') as { conversation_instructions: string }
      expect(row.conversation_instructions).toBe('')
    })

    it('迁移完成后再次运行不会重复改写数据', () => {
      runV4MigrationWithOldData({
        modelId: 'm1',
        providerId: 'p1',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: '保持简洁',
      })
      const before = sqlite.prepare('SELECT settings, conversation_instructions FROM conversations WHERE id = ?').get('v4-c')

      runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath }))

      const after = sqlite.prepare('SELECT settings, conversation_instructions FROM conversations WHERE id = ?').get('v4-c')
      expect(after).toEqual(before)
      const applied = sqlite.prepare('SELECT COUNT(*) AS count FROM app_data_migrations WHERE version = 4').get() as { count: number }
      expect(applied.count).toBe(1)
    })
  })
})

function requireBetterSqlite(): new (filename: string) => Database {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as new (filename: string) => Database
}
