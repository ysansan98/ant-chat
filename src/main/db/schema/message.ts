import type { AttachmentSchema, McpToolCall, MessageContent, ModelInfo } from '@ant-chat/shared'
import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'

// 消息表
export const messagesTable = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => `msg-${nanoid()}`),
  convId: text('conv_id').notNull(),
  role: text('role').notNull(),
  content: text('content', { mode: 'json' }).notNull().$type<MessageContent>(),
  createdAt: integer('created_at').notNull().default(sql`(strftime('%s','now'))`),
  status: text('status').notNull(),
  images: text('images', { mode: 'json' }).$type<AttachmentSchema[]>().default([]),
  attachments: text('attachments', { mode: 'json' }).$type<AttachmentSchema[]>().default([]),
  reasoningContent: text('reasoning_content'),
  mcpTool: text('mcp_tool', { mode: 'json' }).$type<McpToolCall[] | null>().default(null),
  modelInfo: text('model_info', { mode: 'json' }).$type<ModelInfo | null>().default(null),
})
