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
    ]))
    expect(history).toEqual([
      { version: 1, name: '初始化 app-data schema' },
      { version: 2, name: '增加会话归档状态' },
      { version: 3, name: '重命名自动化 selected 字段为 allowed' },
      { version: 4, name: '分离会话指令并迁移输出 token 字段' },
    ])
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
    expect(sqlite.prepare('SELECT version FROM app_data_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }])
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
