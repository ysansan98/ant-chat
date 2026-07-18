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
    {
      version: 3,
      name: '重命名自动化 selected 字段为 allowed',
      migrate(db) {
        const columns = db.prepare('PRAGMA table_info(automations)').all() as Array<{ name: string }>
        const colNames = new Set(columns.map(c => c.name))
        if (colNames.has('selected_skills') && !colNames.has('allowed_skills')) {
          db.exec('ALTER TABLE automations RENAME COLUMN selected_skills TO allowed_skills')
        }
        if (colNames.has('selected_mcp_servers') && !colNames.has('allowed_mcp_servers')) {
          db.exec('ALTER TABLE automations RENAME COLUMN selected_mcp_servers TO allowed_mcp_servers')
        }
      },
    },
    {
      version: 4,
      name: '分离会话指令并迁移输出 token 字段',
      migrate(db) {
        // 1. 新增 conversation_instructions 列
        const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
        if (!columns.some(col => col.name === 'conversation_instructions')) {
          db.exec('ALTER TABLE conversations ADD COLUMN conversation_instructions text NOT NULL DEFAULT \'\'')
        }

        // 2. 逐行迁移已有的 settings JSON
        const rows = db.prepare('SELECT id, settings FROM conversations').all() as Array<{ id: string, settings: string }>
        const updateStmt = db.prepare('UPDATE conversations SET conversation_instructions = ?, settings = ? WHERE id = ?')

        for (const row of rows) {
          try {
            const settings = JSON.parse(row.settings) as Record<string, unknown>
            const systemPrompt = typeof settings.systemPrompt === 'string' ? settings.systemPrompt : ''
            delete settings.systemPrompt

            // maxTokens → maxOutputTokens
            if (settings.maxTokens !== undefined && settings.maxOutputTokens === undefined) {
              settings.maxOutputTokens = settings.maxTokens
            }
            delete settings.maxTokens

            updateStmt.run(systemPrompt, JSON.stringify(settings), row.id)
          }
          catch (error) {
            throw new Error(`Migration v4: failed to parse settings for conversation ${row.id}: ${error}`)
          }
        }
      },
    },
    {
      version: 5,
      name: '关联自动化运行与 Agent Turn',
      migrate(db) {
        const columns = db.prepare('PRAGMA table_info(automation_runs)').all() as Array<{ name: string }>
        if (columns.length > 0 && !columns.some(column => column.name === 'turn_id')) {
          db.exec('ALTER TABLE automation_runs ADD COLUMN turn_id text')
        }
      },
    },
  ]
}
