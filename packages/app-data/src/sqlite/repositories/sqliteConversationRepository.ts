import type { AddConversationsSchema, IConversations, UpdateConversationsSchema } from '@ant-chat/shared'
import type { ConversationRepository } from '../../repositories'
import type { AppDataDatabase } from '../types'
import { AddConversationsSchema as AddConversationInput, UpdateConversationsSchema as UpdateConversationInput } from '@ant-chat/shared'
import { eq, isNull, or, sql } from 'drizzle-orm'
import { conversationsTable } from '../schema'

export class SqliteConversationRepository implements ConversationRepository {
  constructor(private readonly db: AppDataDatabase) {}

  async list(pageIndex: number, pageSize: number = 10, workspacePath?: string, includeNullWorkspace = false) {
    const where = getWorkspaceWhere(workspacePath, includeNullWorkspace)
    const totalResult = this.db.select({ count: sql<number>`count(1)` })
      .from(conversationsTable)
      .where(where)
      .get()
    const data = this.db.select()
      .from(conversationsTable)
      .where(where)
      .orderBy(sql`${conversationsTable.updatedAt} DESC`)
      .limit(pageSize)
      .offset(pageIndex * pageSize)
      .all()

    return {
      data: data as IConversations[],
      total: totalResult?.count ?? 0,
    }
  }

  async getById(id: string): Promise<IConversations> {
    const result = this.db.select().from(conversationsTable).where(eq(conversationsTable.id, id)).get()
    if (!result) {
      throw new Error(`${id} 不存在`)
    }
    return result as IConversations
  }

  async create(conversation: AddConversationsSchema): Promise<IConversations> {
    const parsed = AddConversationInput.parse(conversation)
    const result = this.db.insert(conversationsTable)
      .values(parsed)
      .returning()
      .get()
    return result as IConversations
  }

  async update(conversation: UpdateConversationsSchema): Promise<IConversations> {
    const data = UpdateConversationInput.parse(conversation)
    const result = this.db.update(conversationsTable)
      .set(data)
      .where(eq(conversationsTable.id, data.id))
      .returning()
      .get()

    return result as IConversations
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.delete(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .returning()
      .get()
    if (!result)
      throw new Error('会话未找到')

    return true
  }

  async exists(id: string): Promise<boolean> {
    return !!this.db.select({ count: sql<number>`COUNT(1)` }).from(conversationsTable).where(eq(conversationsTable.id, id)).get()
  }

  async updateUpdatedAt(id: string, updatedAt: number): Promise<IConversations> {
    return this.update({ id, updatedAt })
  }
}

function getWorkspaceWhere(workspacePath?: string, includeNullWorkspace = false) {
  if (!workspacePath) {
    return undefined
  }

  return includeNullWorkspace
    ? or(eq(conversationsTable.workspacePath, workspacePath), isNull(conversationsTable.workspacePath))
    : eq(conversationsTable.workspacePath, workspacePath)
}
