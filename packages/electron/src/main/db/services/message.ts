import type { AddMessage, AIMessage, IMessage, UpdateMessageSchema } from '@ant-chat/shared'

import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import {
  conversationsTable,
  messagesTable,
} from '../schema'
import { getConversationById } from './conversations'

// ==================== 消息操作 ====================
export async function getMessagesByConvId(convId: string): Promise<IMessage[]> {
  const data = await db.select().from(messagesTable).where(eq(messagesTable.convId, convId))

  return data as IMessage[]
}

export async function getMessageById(id: string): Promise<IMessage> {
  const result = db.select().from(messagesTable).where(eq(messagesTable.id, id)).get()

  if (!result) {
    throw new Error('消息未找到')
  }

  return result as IMessage
}

export async function addMessage(message: AddMessage): Promise<IMessage> {
  // 先检查对应的会话是否存在
  const conversation = await getConversationById(message.convId)
  if (!conversation) {
    throw new Error('会话未找到')
  }

  const result = db.insert(messagesTable)
    .values({ ...message, createdAt: Date.now() })
    .returning()
    .get()

  return result as IMessage
}

export async function createAIMessage(convId: string, modelInfo: AIMessage['modelInfo']) {
  return await addMessage({
    convId,
    content: [],
    role: 'assistant',
    status: 'loading',
    modelInfo,
    reasoningContent: '',
  })
}

export async function updateMessage(message: UpdateMessageSchema): Promise<IMessage> {
  db.transaction((tx) => {
    const result = tx.update(messagesTable).set(message).where(eq(messagesTable.id, message.id)).returning().get()
    tx.update(conversationsTable).set({ updatedAt: Date.now() }).where(eq(conversationsTable.id, result.convId)).returning().get()
  })

  return getMessageById(message.id)
}

export async function deleteMessage(id: string): Promise<boolean> {
  await db.delete(messagesTable)
    .where(eq(messagesTable.id, id))

  return true
}

export async function getMessagesByConvIdWithPagination(id: string, pageIndex: number, pageSize: number): Promise<{ data: IMessage[], total: number }> {
  // 获取总记录数
  const countResult = db.select({ count: sql<number>`count(1)` })
    .from(messagesTable)
    .where(eq(messagesTable.convId, id))
    .get()

  const total = countResult ? Number(countResult.count) : 0

  // 获取分页数据
  const results = db.select()
    .from(messagesTable)
    .where(eq(messagesTable.convId, id))
    .orderBy(desc(messagesTable.createdAt))
    .limit(pageSize)
    .offset(pageIndex * pageSize)
    .all()

  return {
    data: (results as IMessage[]).toReversed(),
    total,
  }
}

export async function batchDeleteMessages(ids: string[]): Promise<boolean> {
  for (const id of ids) {
    await deleteMessage(id)
  }
  return true
}
