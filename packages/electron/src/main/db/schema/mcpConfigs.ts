import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// MCP配置表
export const mcpConfigsTable = sqliteTable('mcp_configs', {
  serverName: text('server_name').primaryKey(),
  icon: text('icon').notNull(),
  description: text('description'),
  timeout: integer('timeout').default(30),
  transportType: text('transport_type', { enum: ['stdio', 'sse'] }).notNull(),
  createdAt: integer('created_at').notNull().default(sql`(strftime('%s','now'))`),
  updatedAt: integer('updated_at').notNull().default(sql`(strftime('%s','now'))`),

  // sse 特有字段
  url: text('url'),
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>().default({}),

  // stdio 特有字段
  command: text('command'),
  args: text('args', { mode: 'json' }).$type<string[] | null>().default(null),
  env: text('env', { mode: 'json' }).$type<Record<string, any> | null>().default(null),
})
