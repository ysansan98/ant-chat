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
    expect(sqlite.prepare('SELECT version FROM app_data_migrations').all()).toEqual([{ version: 1 }, { version: 2 }])
  })
})

function requireBetterSqlite(): new (filename: string) => Database {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as new (filename: string) => Database
}
