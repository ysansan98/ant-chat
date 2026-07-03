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
  ]
}
