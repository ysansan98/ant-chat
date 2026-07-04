import type { SqliteMigration } from './runMigrations'
import path from 'node:path'
import { initializeAppDataSchema } from '../schema'
import { migrateAddCompactionBoundary, migrateAddDurationMs, migrateMessageAttachments, rebuildMessagesTable } from './migrateAttachments'

export interface CreateAppDataMigrationsOptions {
  attachmentsRootPath: string
}

export function createAppDataMigrations(
  options: CreateAppDataMigrationsOptions,
): readonly SqliteMigration[] {
  return [
    {
      version: 1,
      name: '初始化 app-data schema',
      migrate(db) {
        initializeAppDataSchema(db)
        migrateAddDurationMs(db)
        migrateMessageAttachments(db, path.resolve(options.attachmentsRootPath))
        rebuildMessagesTable(db)
        migrateAddCompactionBoundary(db)
      },
    },
    {
      version: 2,
      name: '增加会话归档状态',
      migrate(db) {
        const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
        if (!columns.some(column => column.name === 'archived')) {
          db.exec('ALTER TABLE conversations ADD COLUMN archived integer NOT NULL DEFAULT 0')
        }
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_conversations_workspace_path_archived_updated_at
            ON conversations (workspace_path, archived, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_conversations_archived_updated_at
            ON conversations (archived, updated_at DESC);
        `)
      },
    },
  ]
}
