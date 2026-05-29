import type { AddMessage, AIMessage, IMessage, UpdateMessageSchema } from '@ant-chat/shared'
import type { MessageRepository } from '../../repositories'
import type { MessageRow } from '../rows'
import type { AppDataDatabase } from '../types'
import { nanoid } from 'nanoid'
import { mapMessageRow, stringifyJson } from '../rows'
import { SqliteConversationRepository } from './sqliteConversationRepository'

const MESSAGE_COLUMNS = `
  id,
  conv_id,
  role,
  content,
  created_at,
  status,
  images,
  attachments,
  reasoning_content,
  model_info,
  usage,
  turn_id,
  event_type
`

export class SqliteMessageRepository implements MessageRepository {
  private readonly conversations: SqliteConversationRepository

  constructor(private readonly db: AppDataDatabase) {
    this.conversations = new SqliteConversationRepository(db)
  }

  async listByConversation(conversationId: string): Promise<IMessage[]> {
    const data = this.db.prepare<unknown[], MessageRow>(`
      SELECT ${MESSAGE_COLUMNS}
      FROM messages
      WHERE conv_id = ?
    `).all(conversationId)

    return data.map(mapMessageRow)
  }

  async listByConversationPaginated(conversationId: string, pageIndex: number, pageSize: number): Promise<{ data: IMessage[], total: number }> {
    const countResult = this.db.prepare<unknown[], { count: number }>(`
      SELECT count(1) AS count
      FROM messages
      WHERE conv_id = ?
    `).get(conversationId)
    const results = this.db.prepare<unknown[], MessageRow>(`
      SELECT ${MESSAGE_COLUMNS}
      FROM messages
      WHERE conv_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(conversationId, pageSize, pageIndex * pageSize)

    return {
      data: results.map(mapMessageRow).reverse(),
      total: countResult?.count ?? 0,
    }
  }

  async getById(id: string): Promise<IMessage> {
    const result = this.db.prepare<unknown[], MessageRow>(`
      SELECT ${MESSAGE_COLUMNS}
      FROM messages
      WHERE id = ?
    `).get(id)
    if (!result) {
      throw new Error('消息未找到')
    }

    return mapMessageRow(result)
  }

  async create(message: AddMessage): Promise<IMessage> {
    await this.conversations.getById(message.convId)

    const id = `msg-${nanoid()}`
    const result = this.db.prepare<unknown[], MessageRow>(`
      INSERT INTO messages (
        id,
        conv_id,
        role,
        content,
        created_at,
        status,
        images,
        attachments,
        reasoning_content,
        model_info,
        usage,
        turn_id,
        event_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING ${MESSAGE_COLUMNS}
    `).get(
      id,
      message.convId,
      message.role,
      stringifyJson(message.content),
      Date.now(),
      message.status,
      'images' in message ? stringifyJson(message.images) : stringifyJson([]),
      'attachments' in message ? stringifyJson(message.attachments) : stringifyJson([]),
      'reasoningContent' in message ? message.reasoningContent ?? null : null,
      'modelInfo' in message ? stringifyNullableJson(message.modelInfo) : null,
      'usage' in message ? stringifyNullableJson(message.usage) : null,
      'turnId' in message ? message.turnId ?? null : null,
      'eventType' in message ? message.eventType ?? null : null,
    )

    if (!result) {
      throw new Error('创建消息失败')
    }

    return mapMessageRow(result)
  }

  async createAssistant(conversationId: string, modelInfo: AIMessage['modelInfo'], turnId?: string): Promise<IMessage> {
    return this.create({
      convId: conversationId,
      content: [],
      role: 'assistant',
      status: 'loading',
      modelInfo,
      reasoningContent: '',
      turnId,
    } as Extract<AddMessage, { role: 'assistant' }>)
  }

  async update(message: UpdateMessageSchema): Promise<IMessage> {
    const fields: string[] = []
    const params: unknown[] = []

    if (message.convId !== undefined) {
      fields.push('conv_id = ?')
      params.push(message.convId)
    }
    if (message.role !== undefined) {
      fields.push('role = ?')
      params.push(message.role)
    }
    if (message.content !== undefined) {
      fields.push('content = ?')
      params.push(stringifyJson(message.content))
    }
    if (message.status !== undefined) {
      fields.push('status = ?')
      params.push(message.status)
    }
    if (message.images !== undefined) {
      fields.push('images = ?')
      params.push(stringifyJson(message.images))
    }
    if (message.attachments !== undefined) {
      fields.push('attachments = ?')
      params.push(stringifyJson(message.attachments))
    }
    if (message.reasoningContent !== undefined) {
      fields.push('reasoning_content = ?')
      params.push(message.reasoningContent)
    }
    if (message.modelInfo !== undefined) {
      fields.push('model_info = ?')
      params.push(stringifyNullableJson(message.modelInfo))
    }
    if (message.usage !== undefined) {
      fields.push('usage = ?')
      params.push(stringifyNullableJson(message.usage))
    }
    if (message.turnId !== undefined) {
      fields.push('turn_id = ?')
      params.push(message.turnId)
    }
    if (message.eventType !== undefined) {
      fields.push('event_type = ?')
      params.push(message.eventType)
    }

    if (fields.length === 0) {
      return this.getById(message.id)
    }

    const updateMessage = this.db.transaction(() => {
      const result = this.db.prepare<unknown[], MessageRow>(`
        UPDATE messages
        SET ${fields.join(', ')}
        WHERE id = ?
        RETURNING ${MESSAGE_COLUMNS}
      `).get(...params, message.id)

      if (!result) {
        throw new Error('消息未找到')
      }

      this.db.prepare(`
        UPDATE conversations
        SET updated_at = ?
        WHERE id = ?
      `).run(Date.now(), result.conv_id)

      return result
    })

    return mapMessageRow(updateMessage())
  }

  async delete(id: string): Promise<boolean> {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id)
    return true
  }

  async batchDelete(ids: string[]): Promise<boolean> {
    const deleteMessages = this.db.transaction((messageIds: string[]) => {
      const statement = this.db.prepare('DELETE FROM messages WHERE id = ?')
      for (const id of messageIds) {
        statement.run(id)
      }
    })

    deleteMessages(ids)
    return true
  }
}

function stringifyNullableJson(value: unknown): string | null {
  return value === null || value === undefined ? null : stringifyJson(value)
}
