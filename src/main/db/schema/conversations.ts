import type { ConversationsSettingsSchema } from '@ant-chat/shared'
import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'

// 会话表
export const conversationsTable = sqliteTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => `conv-${nanoid()}`),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull().default(sql`(strftime('%s','now'))`),
  updatedAt: integer('updated_at').notNull().default(sql`(strftime('%s','now'))`),
  settings: text('settings', { mode: 'json' }).$type<ConversationsSettingsSchema>().notNull(),
})
