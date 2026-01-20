import type { IConversations } from '@ant-chat/shared'

import {
  AddConversationsSchema,
  UpdateConversationsSchema,
} from '@ant-chat/shared'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import {
  conversationsTable,
} from '../schema'

export async function getConversationsTotal() {
  const result = db.select({ count: sql<number>`count(1)` }).from(conversationsTable).get()
  return result?.count ?? 0
}

export async function conversationsIsExists(id: string): Promise<boolean> {
  return !!(db.select({ count: sql<number>`COUNT(1)` }).from(conversationsTable).where(eq(conversationsTable.id, id)).get())
}

export async function getConversations(pageIndex: number, pageSize: number = 10): Promise<IConversations[]> {
  const results = await db.select()
    .from(conversationsTable)
    .orderBy(sql`${conversationsTable.updatedAt} DESC`)
    .limit(pageSize)
    .offset(pageIndex * pageSize)

  return results as IConversations[]
}

export async function getConversationById(id: string): Promise<IConversations> {
  const result = db.select().from(conversationsTable).where(eq(conversationsTable.id, id)).get()
  if (!result) {
    throw new Error(`${id} 不存在`)
  }
  return result as IConversations
}

export async function addConversation(conversation: AddConversationsSchema): Promise<IConversations> {
  const parsed = AddConversationsSchema.parse(conversation)
  const result = db.insert(conversationsTable)
    .values(parsed)
    .returning()
    .get()
  return result as IConversations
}

export async function updateConversation(conversation: UpdateConversationsSchema): Promise<IConversations> {
  const data = UpdateConversationsSchema.parse(conversation)
  const result = db.update(conversationsTable)
    .set(data)
    .where(eq(conversationsTable.id, data.id))
    .returning()
    .get()

  return result as IConversations
}

export async function deleteConversation(id: string): Promise<boolean> {
  const result = db.delete(conversationsTable)
    .where(eq(conversationsTable.id, id))
    .returning()
    .get()
  if (!result)
    throw new Error('会话未找到')

  return true
}

export async function updateConversationUpdateAt(id: string, updatedAt: number): Promise<IConversations> {
  const data = UpdateConversationsSchema.parse({ id, updatedAt })
  const result = db.update(conversationsTable)
    .set(data)
    .where(eq(conversationsTable.id, id))
    .returning()
    .get()

  return result as IConversations
}
