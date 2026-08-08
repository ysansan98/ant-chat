import type { AppDataDatabase } from '../types'
import type { SqliteMigration } from './runMigrations'
import path from 'node:path'
import { MessageSearchIndex } from '../messageSearchIndex'
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
    {
      version: 6,
      name: '增加消息频道数据模型',
      migrate(db) {
        const conversationColumns = new Set((db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>).map(column => column.name))
        const messageColumns = new Set((db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(column => column.name))
        const hasMessagesTable = Boolean(db.prepare('SELECT 1 AS present FROM sqlite_master WHERE type = \'table\' AND name = \'messages\'').get())
        if (!conversationColumns.has('source_type'))
          db.exec('ALTER TABLE conversations ADD COLUMN source_type text NOT NULL DEFAULT \'local\'')
        if (!conversationColumns.has('source_channel_account_id'))
          db.exec('ALTER TABLE conversations ADD COLUMN source_channel_account_id text')
        if (!conversationColumns.has('source_external_chat_id'))
          db.exec('ALTER TABLE conversations ADD COLUMN source_external_chat_id text')
        if (hasMessagesTable && !messageColumns.has('origin_type'))
          db.exec('ALTER TABLE messages ADD COLUMN origin_type text NOT NULL DEFAULT \'local\'')
        if (hasMessagesTable && !messageColumns.has('origin_channel_account_id'))
          db.exec('ALTER TABLE messages ADD COLUMN origin_channel_account_id text')
        if (hasMessagesTable && !messageColumns.has('origin_external_chat_id'))
          db.exec('ALTER TABLE messages ADD COLUMN origin_external_chat_id text')
        db.exec(`
          CREATE TABLE IF NOT EXISTS channel_accounts (
            id text PRIMARY KEY NOT NULL, channel_type text NOT NULL, display_name text NOT NULL,
            credential_ref text NOT NULL, default_workspace_path text, enabled integer NOT NULL DEFAULT 0,
            status text NOT NULL, last_error text, created_at integer NOT NULL, updated_at integer NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_accounts_type ON channel_accounts(channel_type);
          CREATE TABLE IF NOT EXISTS channel_pairings (
            id text PRIMARY KEY NOT NULL, channel_account_id text NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
            external_user_id text NOT NULL, external_display_name text NOT NULL, status text NOT NULL,
            requested_at integer NOT NULL, expires_at integer, approved_at integer
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_pairings_identity ON channel_pairings(channel_account_id, external_user_id);
          CREATE TABLE IF NOT EXISTS channel_sessions (
            channel_account_id text NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
            external_chat_id text NOT NULL, active_conversation_id text NOT NULL REFERENCES conversations(id),
            current_workspace_path text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
            PRIMARY KEY (channel_account_id, external_chat_id)
          );
          CREATE TABLE IF NOT EXISTS channel_message_receipts (
            id text PRIMARY KEY NOT NULL, channel_account_id text NOT NULL, external_chat_id text NOT NULL,
            external_message_id text NOT NULL, direction text NOT NULL, local_message_id text, status text NOT NULL,
            part_index integer, part_count integer, last_error text, created_at integer NOT NULL, updated_at integer NOT NULL,
            UNIQUE (channel_account_id, external_message_id, direction, part_index)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_receipts_idempotency
            ON channel_message_receipts (channel_account_id, external_message_id, direction, COALESCE(part_index, -1));
        `)
      },
    },
    {
      version: 7,
      name: '约束频道出站消息与平台消息一一对应',
      migrate(db) {
        db.exec(`
          DELETE FROM channel_message_receipts
          WHERE direction = 'outbound'
            AND local_message_id IS NOT NULL
            AND id NOT IN (
              SELECT MIN(id)
              FROM channel_message_receipts
              WHERE direction = 'outbound' AND local_message_id IS NOT NULL
              GROUP BY channel_account_id, local_message_id
            );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_receipts_outbound_local_message
            ON channel_message_receipts (channel_account_id, local_message_id)
            WHERE direction = 'outbound' AND local_message_id IS NOT NULL;
        `)
      },
    },
    {
      version: 8,
      name: '增加消息频道权限模式',
      migrate(db) {
        const columns = db.prepare('PRAGMA table_info(channel_accounts)').all() as Array<{ name: string }>
        if (!columns.some(column => column.name === 'permission_mode')) {
          db.exec('ALTER TABLE channel_accounts ADD COLUMN permission_mode text NOT NULL DEFAULT \'hybrid\'')
        }
      },
    },
    {
      version: 9,
      name: '消息搜索投影、FTS 与长期记忆目录',
      migrate(db) {
        // messages 表缺失时（异常的历史状态）跳过消息索引部分，不阻塞其他迁移
        const hasMessagesTable = Boolean(db.prepare(`
          SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'messages'
        `).get())
        if (hasMessagesTable) {
          migrateMessageSearchIndex(db)
        }
        migrateMemoryCatalogTables(db)
      },
    },
    {
      version: 10,
      name: '记录微信扫码登录 owner 身份',
      migrate(db) {
        const columns = db.prepare('PRAGMA table_info(channel_accounts)').all() as Array<{ name: string }>
        if (!columns.some(column => column.name === 'owner_user_id'))
          db.exec('ALTER TABLE channel_accounts ADD COLUMN owner_user_id text')
      },
    },
  ]
}

function migrateMessageSearchIndex(db: AppDataDatabase): void {
  // 1. ordinal：会话内稳定排序键（消息 ID 是随机值，不能用于窗口排序）
  const messageColumns = new Set((db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(column => column.name))
  if (!messageColumns.has('ordinal')) {
    db.exec('ALTER TABLE messages ADD COLUMN ordinal integer')
  }
  // 历史回填：按 created_at, rowid 在同一会话内分配递增 ordinal
  db.exec(`
    CREATE TEMP TABLE _migration_msg_ordinals AS
      SELECT id, ROW_NUMBER() OVER (PARTITION BY conv_id ORDER BY created_at, rowid) AS ordinal
      FROM messages;
    UPDATE messages
      SET ordinal = (SELECT ordinal FROM _migration_msg_ordinals WHERE _migration_msg_ordinals.id = messages.id)
      WHERE ordinal IS NULL;
    DROP TABLE _migration_msg_ordinals;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_ordinal
      ON messages(conv_id, ordinal);
  `)

  // 2. 搜索投影 + 结构化 tool 事实（派生读模型，不改动 messages.content JSON 语义）
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_search_documents (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      text TEXT NOT NULL,
      tool_text TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_message_search_documents_conversation_ordinal
      ON message_search_documents(conversation_id, ordinal);
    CREATE TABLE IF NOT EXISTS message_tool_facts (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      server_name TEXT,
      args_text TEXT NOT NULL DEFAULT '',
      result_text TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (message_id, tool_call_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_message_tool_facts_tool
      ON message_tool_facts(tool_name, server_name);
    CREATE TABLE IF NOT EXISTS message_search_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `)

  // 3. standalone FTS5 表：先探测 bundled SQLite 的 FTS5/trigram 支持，
  //    不支持则显式降级为 LIKE（记录在 message_search_meta，查询侧读取）
  const fts5 = tryCreateFtsTable(db, `
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_unicode
    USING fts5(message_id UNINDEXED, text, tool_text, tokenize='unicode61')
  `)
  db.prepare('INSERT OR REPLACE INTO message_search_meta (key, value) VALUES (?, ?)').run('fts5', fts5 ? '1' : '0')
  const ftsTrigram = fts5 && tryCreateFtsTable(db, `
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram
    USING fts5(message_id UNINDEXED, text, tool_text, tokenize='trigram')
  `)
  db.prepare('INSERT OR REPLACE INTO message_search_meta (key, value) VALUES (?, ?)').run('fts_trigram', ftsTrigram ? '1' : '0')

  // 4. 历史回填：与运行时维护共用同一抽取实现
  new MessageSearchIndex(db).rebuild()
}

function migrateMemoryCatalogTables(db: AppDataDatabase): void {
  // 长期记忆目录：pending 由 agent 提议，批准后写 Markdown 并激活
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_key TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body_content TEXT NOT NULL DEFAULT '',
      body_path TEXT NOT NULL DEFAULT '',
      body_sha256 TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      approved_at INTEGER,
      archived_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_memories_workspace_status
      ON memories(workspace_key, status);
    CREATE TABLE IF NOT EXISTS memory_evidence (
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      PRIMARY KEY (memory_id, message_id)
    );
  `)
  // memories FTS 表跟随消息 FTS 的能力探测结果创建；不可用时记忆搜索显式降级为 LIKE
  tryCreateFtsTable(db, `
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts_trigram
    USING fts5(memory_id UNINDEXED, title, summary, tokenize='trigram')
  `)
}

/**
 * 尝试创建 FTS 虚拟表。FTS5 或 tokenizer 不可用时返回 false，
 * 上层必须显式降级（记录能力位），不能静默得到空搜索结果。
 */
function tryCreateFtsTable(db: AppDataDatabase, sql: string): boolean {
  try {
    db.exec(sql)
    return true
  }
  catch {
    return false
  }
}
