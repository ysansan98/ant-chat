import type { AddMessage, AIMessage, IMessage, UpdateMessageSchema } from '@ant-chat/shared'
import type { MessageRepository } from '../../repositories'
import type { AppDataDatabase } from '../types'
import { desc, eq, sql } from 'drizzle-orm'
import { conversationsTable, messagesTable } from '../schema'
import { SqliteConversationRepository } from './sqliteConversationRepository'

export class SqliteMessageRepository implements MessageRepository {
  private readonly conversations: SqliteConversationRepository

  constructor(private readonly db: AppDataDatabase) {
    this.conversations = new SqliteConversationRepository(db)
  }

  async listByConversation(conversationId: string): Promise<IMessage[]> {
    const data = await this.db.select().from(messagesTable).where(eq(messagesTable.convId, conversationId))
    return data as IMessage[]
  }

  async listByConversationPaginated(conversationId: string, pageIndex: number, pageSize: number): Promise<{ data: IMessage[], total: number }> {
    const countResult = this.db.select({ count: sql<number>`count(1)` })
      .from(messagesTable)
      .where(eq(messagesTable.convId, conversationId))
      .get()
    const total = countResult ? Number(countResult.count) : 0

    const results = this.db.select()
      .from(messagesTable)
      .where(eq(messagesTable.convId, conversationId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(pageSize)
      .offset(pageIndex * pageSize)
      .all()

    return {
      data: [...(results as IMessage[])].reverse(),
      total,
    }
  }

  async getById(id: string): Promise<IMessage> {
    const result = this.db.select().from(messagesTable).where(eq(messagesTable.id, id)).get()
    if (!result) {
      throw new Error('消息未找到')
    }

    return result as IMessage
  }

  async create(message: AddMessage): Promise<IMessage> {
    await this.conversations.getById(message.convId)
    const result = this.db.insert(messagesTable)
      .values({ ...message, createdAt: Date.now() })
      .returning()
      .get()

    return result as IMessage
  }

  async createAssistant(conversationId: string, modelInfo: AIMessage['modelInfo']): Promise<IMessage> {
    return this.create({
      convId: conversationId,
      content: [],
      role: 'assistant',
      status: 'loading',
      modelInfo,
      reasoningContent: '',
    })
  }

  async update(message: UpdateMessageSchema): Promise<IMessage> {
    this.db.transaction((tx) => {
      const result = tx.update(messagesTable).set(message).where(eq(messagesTable.id, message.id)).returning().get()
      tx.update(conversationsTable).set({ updatedAt: Date.now() }).where(eq(conversationsTable.id, result.convId)).returning().get()
    })

    return this.getById(message.id)
  }

  async delete(id: string): Promise<boolean> {
    await this.db.delete(messagesTable)
      .where(eq(messagesTable.id, id))

    return true
  }

  async batchDelete(ids: string[]): Promise<boolean> {
    for (const id of ids) {
      await this.delete(id)
    }
    return true
  }
}
