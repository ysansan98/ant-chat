import type { Database } from 'better-sqlite3'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSqliteMigrations } from '../runMigrations'

const BetterSqlite = requireBetterSqlite()

describe('runSqliteMigrations', () => {
  let sqlite: Database

  beforeEach(() => {
    sqlite = new BetterSqlite(':memory:')
  })

  afterEach(() => {
    sqlite.close()
  })

  it('按版本顺序执行迁移并记录历史，重复启动不再执行', () => {
    const migrations = [
      {
        version: 1,
        name: '创建项目表',
        migrate(db: Pick<Database, 'exec'>) {
          db.exec('CREATE TABLE projects (id text PRIMARY KEY NOT NULL)')
        },
      },
      {
        version: 2,
        name: '增加项目名称',
        migrate(db: Pick<Database, 'exec'>) {
          db.exec('ALTER TABLE projects ADD COLUMN name text')
        },
      },
    ]

    runSqliteMigrations(sqlite, migrations)
    runSqliteMigrations(sqlite, migrations)

    const columns = sqlite.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
    const history = sqlite.prepare(`
      SELECT version, name
      FROM app_data_migrations
      ORDER BY version
    `).all()
    expect(columns.map(column => column.name)).toEqual(['id', 'name'])
    expect(history).toEqual([
      { version: 1, name: '创建项目表' },
      { version: 2, name: '增加项目名称' },
    ])
  })

  it('迁移失败时回滚 schema 修改且不记录版本', () => {
    expect(() => runSqliteMigrations(sqlite, [{
      version: 1,
      name: '失败迁移',
      migrate(db) {
        db.exec('CREATE TABLE unfinished (id text)')
        throw new Error('迁移失败')
      },
    }])).toThrow('迁移失败')

    const table = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unfinished'
    `).get()
    const history = sqlite.prepare('SELECT version FROM app_data_migrations').all()
    expect(table).toBeUndefined()
    expect(history).toEqual([])
  })

  it('拒绝与应用注册表不一致的迁移历史', () => {
    sqlite.exec(`
      CREATE TABLE app_data_migrations (
        version integer PRIMARY KEY NOT NULL,
        name text NOT NULL,
        applied_at integer NOT NULL
      );
      INSERT INTO app_data_migrations VALUES (1, '已被修改的名称', 0);
    `)

    expect(() => runSqliteMigrations(sqlite, [{
      version: 1,
      name: '原始名称',
      migrate() {},
    }])).toThrow('数据库迁移历史不匹配')
  })
})

function requireBetterSqlite(): new (filename: string) => Database {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as new (filename: string) => Database
}
