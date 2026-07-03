import type { AppDataDatabase } from '../types'

export interface SqliteMigration {
  version: number
  name: string
  migrate: (db: AppDataDatabase) => void
}

interface AppliedMigration {
  version: number
  name: string
}

const MIGRATION_TABLE = 'app_data_migrations'

/**
 * 每个版本独立提交，保证 schema 修改与版本记录同时成功或同时回滚。
 * 已发布迁移的版本和名称属于持久化协议，不应修改或复用。
 */
export function runSqliteMigrations(
  db: AppDataDatabase,
  migrations: readonly SqliteMigration[],
): void {
  validateMigrationChain(migrations)
  db.exec('PRAGMA foreign_keys = ON;')
  ensureMigrationTable(db)

  const appliedMigrations = db.prepare(`
    SELECT version, name
    FROM ${MIGRATION_TABLE}
    ORDER BY version ASC
  `).all() as AppliedMigration[]

  validateAppliedMigrations(appliedMigrations, migrations)
  const appliedVersions = new Set(appliedMigrations.map(migration => migration.version))

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue
    }

    db.transaction(() => {
      migration.migrate(db)
      db.prepare(`
        INSERT INTO ${MIGRATION_TABLE} (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, Date.now())
    }).immediate()
  }
}

function ensureMigrationTable(db: AppDataDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      version integer PRIMARY KEY NOT NULL,
      name text NOT NULL,
      applied_at integer NOT NULL
    );
  `)
}

function validateMigrationChain(migrations: readonly SqliteMigration[]): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1
    if (migration.version !== expectedVersion) {
      throw new Error(`SQLite 迁移必须从版本 1 连续注册，缺少版本 ${expectedVersion}`)
    }
    if (!migration.name.trim()) {
      throw new Error(`SQLite 迁移 ${migration.version} 缺少名称`)
    }
  })
}

function validateAppliedMigrations(
  appliedMigrations: readonly AppliedMigration[],
  migrations: readonly SqliteMigration[],
): void {
  appliedMigrations.forEach((applied, index) => {
    const expected = migrations[index]
    if (!expected) {
      throw new Error(`数据库版本 ${applied.version} 高于当前应用支持的版本 ${migrations.length}`)
    }
    if (applied.version !== expected.version || applied.name !== expected.name) {
      throw new Error(
        `数据库迁移历史不匹配: 期望 ${expected.version}:${expected.name}，实际 ${applied.version}:${applied.name}`,
      )
    }
  })
}
