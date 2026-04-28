import type { ConversationsSettingsSchema } from '@ant-chat/shared'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'

// 会话表
export const conversationsTable = sqliteTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => `conv-${nanoid()}`),
  workspacePath: text('workspace_path'),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull().default(sql`(strftime('%s','now'))`),
  updatedAt: integer('updated_at').notNull().default(sql`(strftime('%s','now'))`),
  settings: text('settings', { mode: 'json' }).$type<ConversationsSettingsSchema>().notNull(),
}, table => ({
  workspacePathUpdatedAtIdx: index('idx_conversations_workspace_path_updated_at').on(table.workspacePath, table.updatedAt),
  updatedAtIdx: index('idx_conversations_updated_at').on(table.updatedAt),
}))
