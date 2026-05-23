import type { GeneralSettingsState } from '@ant-chat/shared'
import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const appSettingsTable = sqliteTable('app_settings', {
  key: text('key').primaryKey().notNull(),
  value: text('value', { mode: 'json' }).$type<GeneralSettingsState>().notNull(),
  updatedAt: integer('updated_at').notNull().default(sql`(strftime('%s','now'))`),
})
